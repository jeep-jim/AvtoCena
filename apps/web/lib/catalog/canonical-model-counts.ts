import {canonicalCatalogBrand} from "./brands";
import {vehicleKnowledgeCompact} from "./vehicle-knowledge";

/** One pass over public projections; aliases cannot invent canonical models. */
export function countCanonicalCatalogModels(
  models: Array<{id: string; make: string; model: string; aliases?: string[]; active?: boolean}>,
  rows: Array<{make?: string; model?: string}>,
) {
  const aliases = new Map<string, string | null>();
  const key = (make: string, model: string) => `${canonicalCatalogBrand(make)}:${vehicleKnowledgeCompact(model)}`;
  for (const model of models) {
    if (model.active === false) continue;
    for (const alias of [model.model, ...(model.aliases || [])]) {
      if (!vehicleKnowledgeCompact(alias)) continue;
      const name = key(model.make, alias);
      const old = aliases.get(name);
      aliases.set(name, old === undefined || old === model.id ? model.id : null);
    }
  }
  const counts: Record<string, number> = Object.create(null);
  const recognized = new Map<string, Set<string>>();
  for (const row of rows) {
    const make = canonicalCatalogBrand(String(row.make || ""));
    if (!make) continue;
    counts[make] = (counts[make] || 0) + 1;
    const id = aliases.get(key(make, String(row.model || "")));
    if (!id) continue;
    const ids = recognized.get(make) || new Set<string>();
    ids.add(id);
    recognized.set(make, ids);
  }
  return {counts, canonicalModelCounts: Object.fromEntries([...recognized].map(([make, ids]) => [make, ids.size]))};
}
