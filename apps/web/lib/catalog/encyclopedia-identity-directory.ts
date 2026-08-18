import { encyclopediaIdentityKey, type EncyclopediaAlias } from "./encyclopedia-identity";
import {
  assertEncyclopediaIdentityProductionConnected,
  readEncyclopediaIdentityDataset,
  readEncyclopediaIdentityResolver,
} from "./encyclopedia-identity-data";

function safeAliasValues(aliases: EncyclopediaAlias[] | undefined) {
  return (aliases || [])
    .filter((alias): alias is Exclude<EncyclopediaAlias, string> => typeof alias === "object" && Boolean(alias) && alias.safe === true)
    .map((alias) => String(alias.value || "").trim())
    .filter(Boolean);
}

function searchScore(query: string, values: string[]) {
  const requested = encyclopediaIdentityKey(query);
  if (!requested) return 0;
  let score = 0;
  for (const value of values) {
    const key = encyclopediaIdentityKey(value);
    if (!key) continue;
    if (key === requested) score = Math.max(score, 100);
    else if (key.startsWith(requested)) score = Math.max(score, 80 - Math.min(20, key.length - requested.length));
    else if (key.includes(requested)) score = Math.max(score, 60 - Math.min(20, key.indexOf(requested)));
  }
  return score;
}

async function requiredIdentityData() {
  const [dataset, resolver] = await Promise.all([
    readEncyclopediaIdentityDataset(),
    readEncyclopediaIdentityResolver(),
  ]);
  if (!dataset || !resolver) throw new Error("catalog_encyclopedia_identity_directory_unavailable");
  assertEncyclopediaIdentityProductionConnected(dataset);
  return { dataset, resolver };
}

export async function encyclopediaIdentityFacets(make?: unknown) {
  const { dataset, resolver } = await requiredIdentityData();
  const rawMake = String(make || "").trim();
  const brandId = rawMake ? resolver.resolveBrand(rawMake)?.brand.id || null : null;
  if (rawMake && !brandId) return { makes: [], models: [] as Array<{ id: string; make: string; model: string; aliases: string[] }> };

  const brands = new Map(dataset.brands.map((brand) => [brand.id, brand]));
  const selectedBrands = brandId ? dataset.brands.filter((brand) => brand.id === brandId) : dataset.brands;
  const makes = selectedBrands.map((brand) => brand.canonicalName).sort((a, b) => a.localeCompare(b, "ru"));
  const models = dataset.models
    .filter((model) => !brandId || model.brandId === brandId)
    .map((model) => ({
      id: model.id,
      make: brands.get(model.brandId)?.canonicalName || "",
      model: model.canonicalName,
      aliases: safeAliasValues(model.aliases),
    }))
    .filter((model) => model.make && model.model)
    .sort((left, right) => `${left.make} ${left.model}`.localeCompare(`${right.make} ${right.model}`, "ru"));
  return { makes, models };
}

export async function searchEncyclopediaIdentityModels(query: unknown, make?: unknown, limit = 30) {
  const requested = String(query || "").trim();
  if (!requested) return [];
  const { dataset, resolver } = await requiredIdentityData();

  const rawMake = String(make || "").trim();
  const brandId = rawMake ? resolver.resolveBrand(rawMake)?.brand.id || null : null;
  if (rawMake && !brandId) return [];
  const brands = new Map(dataset.brands.map((brand) => [brand.id, brand]));

  return dataset.models
    .filter((model) => !brandId || model.brandId === brandId)
    .map((model) => {
      const aliases = safeAliasValues(model.aliases);
      const brand = brands.get(model.brandId);
      const brandAliases = safeAliasValues(brand?.aliases);
      const score = Math.max(
        searchScore(requested, [model.canonicalName, ...aliases]),
        searchScore(requested, [
          `${brand?.canonicalName || ""} ${model.canonicalName}`,
          ...brandAliases.flatMap((brandAlias) => [
            `${brandAlias} ${model.canonicalName}`,
            ...aliases.map((alias) => `${brandAlias} ${alias}`),
          ]),
        ]),
      );
      return score && brand ? {
        id: model.id,
        make: brand.canonicalName,
        model: model.canonicalName,
        aliases,
        score,
      } : null;
    })
    .filter((row): row is { id: string; make: string; model: string; aliases: string[]; score: number } => Boolean(row))
    .sort((left, right) => right.score - left.score || `${left.make} ${left.model}`.localeCompare(`${right.make} ${right.model}`, "ru"))
    .slice(0, Math.max(1, Math.min(500, Number(limit) || 30)))
    .map(({ score: _score, ...row }) => row);
}
