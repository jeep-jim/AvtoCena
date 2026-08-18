import { NextResponse } from "next/server";
import { readCatalogFacets } from "@/lib/catalog/storage";
import { resolveVehicleModelQuery, vehicleKnowledgeFacets } from "@/lib/catalog/vehicle-knowledge";
import { catalogEncyclopediaIdentityMode } from "@/lib/catalog/encyclopedia-identity-runtime";
import { resolveConfiguredCatalogSearchParams } from "@/lib/catalog/encyclopedia-identity-query";
import { encyclopediaIdentityFacets, searchEncyclopediaIdentityModels } from "@/lib/catalog/encyclopedia-identity-directory";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ModelSuggestion = { id?: string; make: string; model: string; aliases?: string[] };

function compact(value: unknown) {
  return String(value || "").trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, "");
}

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function positiveNumber(value: string | null) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function mergeSuggestions(primary: ModelSuggestion[], catalog: ModelSuggestion[], query: string, limit: number) {
  const requested = compact(query);
  const merged = new Map<string, ModelSuggestion>();
  for (const item of [...primary, ...catalog]) {
    const key = `${compact(item.make)}:${compact(item.model)}`;
    if (!key.endsWith(":")) merged.set(key, merged.has(key) ? { ...item, ...merged.get(key) } : item);
  }
  return [...merged.values()]
    .filter((item) => !requested || compact(item.model).includes(requested) || (item.aliases || []).some((alias) => compact(alias).includes(requested)))
    .sort((left, right) => {
      const leftModel = compact(left.model);
      const rightModel = compact(right.model);
      const leftRank = leftModel === requested ? 0 : leftModel.startsWith(requested) ? 1 : 2;
      const rightRank = rightModel === requested ? 0 : rightModel.startsWith(requested) ? 1 : 2;
      return leftRank - rightRank || `${left.make} ${left.model}`.localeCompare(`${right.make} ${right.model}`, "ru");
    })
    .slice(0, limit);
}

function contextualFilters(searchParams: URLSearchParams, make: string, includeModel: boolean) {
  const budgetTo = positiveNumber(searchParams.get("budgetTo")) || positiveNumber(searchParams.get("budget"));
  return {
    market: clean(searchParams.get("market")) || undefined,
    make: make || undefined,
    model: includeModel ? clean(searchParams.get("model")) || undefined : undefined,
    bodyType: clean(searchParams.get("bodyType")) || undefined,
    transmission: clean(searchParams.get("transmission")) || undefined,
    fuel: clean(searchParams.get("fuel")) || undefined,
    drive: clean(searchParams.get("drive")) || undefined,
    yearFrom: positiveNumber(searchParams.get("yearFrom")),
    yearTo: positiveNumber(searchParams.get("yearTo")),
    budgetFrom: positiveNumber(searchParams.get("budgetFrom")),
    budgetTo,
    mileageFrom: positiveNumber(searchParams.get("mileageFrom")),
    mileageTo: positiveNumber(searchParams.get("mileageTo")),
    engineFrom: positiveNumber(searchParams.get("engineFrom")),
    engineTo: positiveNumber(searchParams.get("engineTo")),
    powerFrom: positiveNumber(searchParams.get("powerFrom")),
    powerTo: positiveNumber(searchParams.get("powerTo")),
  };
}

function hasInventoryContext(filters: Record<string, unknown>) {
  return Object.values(filters).some((value) => value !== undefined && value !== "");
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawQuery = clean(url.searchParams.get("q"));
  const rawMake = clean(url.searchParams.get("make"));
  const mode = catalogEncyclopediaIdentityMode();
  const identitySearch = await resolveConfiguredCatalogSearchParams({ make: rawMake || undefined, model: rawQuery || undefined });
  const query = clean(identitySearch.model || rawQuery);
  const make = clean(identitySearch.make || rawMake);
  const makeValues = [...new Set(make.split(",").map(clean).filter(Boolean))];
  const scope = clean(url.searchParams.get("scope"));
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 30)));
  const facetFilters = await resolveConfiguredCatalogSearchParams(contextualFilters(url.searchParams, make, true));
  const modelFilters = await resolveConfiguredCatalogSearchParams(contextualFilters(url.searchParams, make, false));
  const inventoryContext = hasInventoryContext(modelFilters);

  if (scope === "facets") {
    const facets = await readCatalogFacets(facetFilters);
    return NextResponse.json({ facets });
  }

  if (!query) {
    if (!make) {
      if (scope !== "makes") return NextResponse.json({ items: [] });
      const facets = await readCatalogFacets(facetFilters);
      return NextResponse.json({
        items: facets.makes.slice(0, limit).map((item) => ({ value: item, label: item })),
      });
    }

    const catalog = await readCatalogFacets(modelFilters);
    const knowledge = inventoryContext
      ? { models: [] as ModelSuggestion[] }
      : mode === "apply"
        ? await encyclopediaIdentityFacets(make)
        : await vehicleKnowledgeFacets(make);
    const models = mergeSuggestions(knowledge.models, catalog.models, "", limit);
    return NextResponse.json({
      items: models.map((item) => ({
        id: item.id,
        make: item.make,
        model: item.model,
        aliases: item.aliases || [],
        label: item.model,
      })),
    });
  }

  const catalogFacets = inventoryContext ? await readCatalogFacets(modelFilters) : { models: [] as ModelSuggestion[] };
  if (!inventoryContext && mode === "apply") {
    const matches = await searchEncyclopediaIdentityModels(query, make || undefined, limit);
    return NextResponse.json({
      items: matches.map((item) => ({
        id: item.id,
        make: item.make,
        model: item.model,
        aliases: item.aliases || [],
        label: makeValues.length === 1 ? item.model : `${item.make} ${item.model}`,
      })),
    });
  }

  const knowledgeMatches = inventoryContext ? [] : await resolveVehicleModelQuery(query, make || undefined, limit);
  const matches = mergeSuggestions(knowledgeMatches, catalogFacets.models, query, limit);
  return NextResponse.json({
    items: matches.map((item) => ({
      id: item.id,
      make: item.make,
      model: item.model,
      aliases: item.aliases || [],
      label: makeValues.length === 1 ? item.model : `${item.make} ${item.model}`,
    })),
  });
}
