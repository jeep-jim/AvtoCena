import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, brandForEntity, byId, loadWorkspace, modelForEntity, normalizeTerm, readJson } from "./lib.mjs";

function sourceIds(entity) {
  return [...new Set((entity.evidence || []).map((item) => item.sourceId).filter(Boolean))];
}

function aliasEntries(entity, base, aliases) {
  return (aliases || []).map((alias) => ({
    ...base,
    term: alias.value,
    key: normalizeTerm(alias.value),
    kind: alias.kind,
    safe: alias.safe,
    sourceIds: alias.sourceIds,
  })).filter((entry) => entry.key);
}

export function buildSearchIndex(data) {
  const indexes = {
    brands: byId(data.records.brand),
    models: byId(data.records.model),
    generations: byId(data.records.generation),
    facelifts: byId(data.records.facelift),
  };
  const entries = [];
  for (const brand of data.records.brand) {
    const base = { entityType: "brand", entityId: brand.id, brandId: brand.id, modelId: null };
    entries.push({ ...base, term: brand.canonicalName, key: normalizeTerm(brand.canonicalName), kind: "canonical", safe: true, sourceIds: sourceIds(brand) });
    entries.push(...aliasEntries(brand, base, brand.aliases));
  }
  for (const model of data.records.model) {
    const brand = indexes.brands.get(model.brandId);
    const base = { entityType: "model", entityId: model.id, brandId: model.brandId, modelId: model.id };
    const evidence = sourceIds(model);
    entries.push({ ...base, term: model.canonicalName, key: normalizeTerm(model.canonicalName), kind: "canonical", safe: true, sourceIds: evidence });
    if (brand) {
      const combined = `${brand.canonicalName} ${model.canonicalName}`;
      entries.push({ ...base, term: combined, key: normalizeTerm(combined), kind: "canonical_make_model", safe: true, sourceIds: [...new Set([...sourceIds(brand), ...evidence])] });
    }
    entries.push(...aliasEntries(model, base, [...(model.aliases || []), ...(model.sourceNames || [])]));
  }
  for (const generation of data.records.generation) {
    const brandId = brandForEntity(generation, indexes);
    const base = { entityType: "generation", entityId: generation.id, brandId, modelId: generation.modelId };
    entries.push({ ...base, term: generation.name, key: normalizeTerm(generation.name), kind: "generation", safe: true, sourceIds: sourceIds(generation) });
    entries.push(...aliasEntries(generation, base, generation.aliases));
    for (const code of generation.platformCodes || []) entries.push({ ...base, term: code, key: normalizeTerm(code), kind: "platform_code", safe: true, sourceIds: sourceIds(generation) });
  }
  for (const facelift of data.records.facelift) {
    const generation = indexes.generations.get(facelift.generationId);
    const base = {
      entityType: "facelift",
      entityId: facelift.id,
      brandId: generation ? brandForEntity(generation, indexes) : null,
      modelId: generation?.modelId || null,
    };
    entries.push({ ...base, term: facelift.name, key: normalizeTerm(facelift.name), kind: "facelift", safe: true, sourceIds: sourceIds(facelift) });
    entries.push(...aliasEntries(facelift, base, facelift.aliases));
  }

  entries.sort((left, right) => left.key.localeCompare(right.key) || left.entityType.localeCompare(right.entityType) || left.entityId.localeCompare(right.entityId) || left.kind.localeCompare(right.kind));
  const collisionMap = new Map();
  for (const entry of entries.filter((row) => row.safe)) {
    const scope = entry.entityType === "brand" ? "global" : entry.brandId || "global";
    const key = `${entry.entityType}:${scope}:${entry.key}`;
    const ids = collisionMap.get(key) || new Set();
    ids.add(entry.entityId);
    collisionMap.set(key, ids);
  }
  const collisions = [...collisionMap.entries()]
    .map(([key, ids]) => ({ key, entityIds: [...ids].sort() }))
    .filter((row) => row.entityIds.length > 1)
    .sort((left, right) => left.key.localeCompare(right.key));
  return { schemaVersion: 2, entries, collisions };
}

function score(entry, requested) {
  if (entry.key === requested) {
    if (!entry.safe) return 70;
    if (entry.kind === "canonical_make_model") return 120;
    if (entry.kind === "canonical") return 115;
    if (entry.kind === "platform_code") return 110;
    return 105;
  }
  if (entry.key.startsWith(requested)) return entry.safe ? 80 - Math.min(20, entry.key.length - requested.length) : 45;
  if (requested.length >= 3 && entry.key.includes(requested)) return entry.safe ? 55 - Math.min(20, entry.key.indexOf(requested)) : 30;
  return 0;
}

export function resolveSearch(index, query, { make, limit = 20 } = {}) {
  const requested = normalizeTerm(query);
  if (!requested) return { query: String(query || ""), normalized: requested, resolved: null, ambiguous: false, matches: [] };
  let brandIds = null;
  if (make) {
    const makeKey = normalizeTerm(make);
    brandIds = new Set(index.entries.filter((entry) => entry.entityType === "brand" && entry.safe && entry.key === makeKey).map((entry) => entry.brandId));
    if (!brandIds.size) return { query: String(query), normalized: requested, resolved: null, ambiguous: false, matches: [] };
  }
  const bestByEntity = new Map();
  for (const entry of index.entries) {
    if (brandIds && !brandIds.has(entry.brandId)) continue;
    const value = score(entry, requested);
    if (!value) continue;
    const current = bestByEntity.get(entry.entityId);
    if (!current || value > current.score || (value === current.score && entry.kind < current.entry.kind)) bestByEntity.set(entry.entityId, { entry, score: value });
  }
  const matches = [...bestByEntity.values()].sort((left, right) => right.score - left.score || left.entry.entityType.localeCompare(right.entry.entityType) || left.entry.entityId.localeCompare(right.entry.entityId)).slice(0, Math.max(1, Number(limit) || 20));
  const topScore = matches[0]?.score || 0;
  const top = matches.filter((row) => row.score === topScore);
  const identities = new Set(top.map((row) => row.entry.modelId || row.entry.entityId));
  const ambiguous = topScore >= 100 && identities.size > 1;
  const resolved = !ambiguous && top.length && top[0].entry.safe && topScore >= 100 ? top[0] : null;
  return { query: String(query), normalized: requested, resolved, ambiguous, matches };
}

async function main() {
  const query = process.argv.slice(2).filter((arg) => !arg.startsWith("--"))[0];
  const makeArg = process.argv.find((arg) => arg.startsWith("--make="));
  if (!query) throw new Error("Usage: node scripts/vehicle-encyclopedia/search.mjs <query> [--make=Brand]");
  const index = await readJson(path.join(WORKSPACE_ROOT, "generated/search-index.json"));
  console.log(JSON.stringify(resolveSearch(index, query, { make: makeArg?.slice("--make=".length) }), null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
