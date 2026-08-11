import { NextResponse } from "next/server";
import { readCatalogFacets } from "@/lib/catalog/storage";
import { resolveVehicleModelQuery, vehicleKnowledgeFacets } from "@/lib/catalog/vehicle-knowledge";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ModelSuggestion = { id?: string; make: string; model: string; aliases?: string[] };

function compact(value: unknown) {
  return String(value || "").trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, "");
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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = String(url.searchParams.get("q") || "").trim();
  const make = String(url.searchParams.get("make") || "").trim();
  const scope = String(url.searchParams.get("scope") || "").trim();
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 30)));

  if (!query) {
    if (!make) {
      if (scope !== "makes") return NextResponse.json({ items: [] });
      const facets = await readCatalogFacets();
      return NextResponse.json({
        items: facets.makes.slice(0, limit).map((item) => ({ value: item, label: item })),
      });
    }
    const [knowledge, catalog] = await Promise.all([
      vehicleKnowledgeFacets(make),
      readCatalogFacets({ make }),
    ]);
    const models = mergeSuggestions(knowledge.models, catalog.models, "", limit);
    return NextResponse.json({
      items: models.map((item) => ({
        make: item.make,
        model: item.model,
        aliases: item.aliases || [],
        label: item.model,
      })),
    });
  }

  const [knowledgeMatches, catalogFacets] = await Promise.all([
    resolveVehicleModelQuery(query, make || undefined, limit),
    make ? readCatalogFacets({ make }) : Promise.resolve({ models: [] }),
  ]);
  const matches = mergeSuggestions(knowledgeMatches, catalogFacets.models, query, limit);
  return NextResponse.json({
    items: matches.map((item) => ({
      id: item.id,
      make: item.make,
      model: item.model,
      aliases: item.aliases || [],
      label: make ? item.model : `${item.make} ${item.model}`,
    })),
  });
}
