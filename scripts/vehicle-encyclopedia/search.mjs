import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, brandForEntity, byId, isPresent, loadWorkspace, normalizeTerm, readJson } from "./lib.mjs";

const VARIANT_SPEC_FIELDS = [
  "market", "yearFrom", "yearTo", "bodyType", "powertrainKind", "fuel", "engineCode", "engineCc",
  "steeringPosition", "transmission", "gears", "drive", "powerHp", "powerHpStandard", "powerKw",
  "icePowerKw", "motorPeakKw", "power30MinKw", "power30MinKwByMotor", "batteryGrossKwh",
  "batteryUsableKwh", "batteryRatedKwh", "rangeKm", "rangeKmMin", "rangeKmMax", "rangeStandard",
  "acChargeKw", "dcChargeKw", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "curbWeightKg",
  "grossWeightKg", "groundClearanceMm", "tankCapacityL", "seats", "doors", "zeroTo100Sec", "topSpeedKmh",
];

function sourceIds(entity) {
  return [...new Set((entity.evidence || []).map((item) => item.sourceId).filter(Boolean))];
}

function safeStatus(entity) {
  return ["seed", "verified"].includes(entity?.status);
}

function aliasEntries(entity, base, aliases, statusSafe = safeStatus(entity)) {
  return (aliases || []).map((alias) => ({
    ...base,
    term: alias.value,
    key: normalizeTerm(alias.value),
    kind: alias.kind,
    safe: statusSafe && alias.safe,
    sourceIds: alias.sourceIds,
  })).filter((entry) => entry.key);
}

export function buildSearchIndex(data) {
  const indexes = {
    brands: byId(data.records.brand),
    models: byId(data.records.model),
    generations: byId(data.records.generation),
    facelifts: byId(data.records.facelift),
    variants: byId(data.records.variant),
  };
  const entries = [];
  const entities = {};
  for (const brand of data.records.brand) {
    const base = { entityType: "brand", entityId: brand.id, brandId: brand.id, modelId: null, generationId: null, faceliftId: null };
    entities[brand.id] = {
      entityType: "brand",
      entityId: brand.id,
      brandId: brand.id,
      canonicalMake: brand.canonicalName,
      status: brand.status,
      sourceIds: sourceIds(brand),
    };
    const brandSafe = safeStatus(brand);
    entries.push({ ...base, term: brand.canonicalName, key: normalizeTerm(brand.canonicalName), kind: "canonical", safe: brandSafe, sourceIds: sourceIds(brand) });
    entries.push(...aliasEntries(brand, base, brand.aliases, brandSafe));
  }
  for (const model of data.records.model) {
    const brand = indexes.brands.get(model.brandId);
    const base = { entityType: "model", entityId: model.id, brandId: model.brandId, modelId: model.id, generationId: null, faceliftId: null };
    const evidence = sourceIds(model);
    entities[model.id] = {
      entityType: "model",
      entityId: model.id,
      brandId: model.brandId,
      modelId: model.id,
      canonicalMake: brand?.canonicalName || null,
      canonicalModel: model.canonicalName,
      status: model.status,
      sourceIds: evidence,
    };
    const canonicalSafe = safeStatus(model) && safeStatus(brand);
    entries.push({ ...base, term: model.canonicalName, key: normalizeTerm(model.canonicalName), kind: "canonical", safe: canonicalSafe, sourceIds: evidence });
    if (brand) {
      const combined = `${brand.canonicalName} ${model.canonicalName}`;
      entries.push({ ...base, term: combined, key: normalizeTerm(combined), kind: "canonical_make_model", safe: canonicalSafe, sourceIds: [...new Set([...sourceIds(brand), ...evidence])] });
    }
    entries.push(...aliasEntries(model, base, [...(model.aliases || []), ...(model.sourceNames || [])], canonicalSafe));
  }
  for (const generation of data.records.generation) {
    const brandId = brandForEntity(generation, indexes);
    const model = indexes.models.get(generation.modelId);
    const brand = indexes.brands.get(brandId);
    const base = { entityType: "generation", entityId: generation.id, brandId, modelId: generation.modelId, generationId: generation.id, faceliftId: null };
    entities[generation.id] = {
      entityType: "generation",
      entityId: generation.id,
      brandId,
      modelId: generation.modelId,
      generationId: generation.id,
      canonicalMake: brand?.canonicalName || null,
      canonicalModel: model?.canonicalName || null,
      canonicalGeneration: generation.name,
      status: generation.status,
      sourceIds: sourceIds(generation),
    };
    const generationSafe = safeStatus(generation) && safeStatus(model) && safeStatus(brand);
    entries.push({ ...base, term: generation.name, key: normalizeTerm(generation.name), kind: "generation", safe: generationSafe, sourceIds: sourceIds(generation) });
    if (model) {
      const modelGeneration = `${model.canonicalName} ${generation.name}`;
      entries.push({ ...base, term: modelGeneration, key: normalizeTerm(modelGeneration), kind: "canonical_model_generation", safe: generationSafe, sourceIds: [...new Set([...sourceIds(model), ...sourceIds(generation)])] });
      if (brand) {
        const makeModelGeneration = `${brand.canonicalName} ${modelGeneration}`;
        entries.push({ ...base, term: makeModelGeneration, key: normalizeTerm(makeModelGeneration), kind: "canonical_make_model_generation", safe: generationSafe, sourceIds: [...new Set([...sourceIds(brand), ...sourceIds(model), ...sourceIds(generation)])] });
      }
    }
    entries.push(...aliasEntries(generation, base, generation.aliases, generationSafe));
    for (const code of generation.platformCodes || []) entries.push({ ...base, term: code, key: normalizeTerm(code), kind: "platform_code", safe: generationSafe, sourceIds: sourceIds(generation) });
  }
  for (const facelift of data.records.facelift) {
    const generation = indexes.generations.get(facelift.generationId);
    const model = generation ? indexes.models.get(generation.modelId) : null;
    const brandId = generation ? brandForEntity(generation, indexes) : null;
    const brand = indexes.brands.get(brandId);
    const base = {
      entityType: "facelift",
      entityId: facelift.id,
      brandId,
      modelId: generation?.modelId || null,
      generationId: generation?.id || null,
      faceliftId: facelift.id,
    };
    entities[facelift.id] = {
      entityType: "facelift",
      entityId: facelift.id,
      brandId,
      modelId: generation?.modelId || null,
      generationId: generation?.id || null,
      faceliftId: facelift.id,
      canonicalMake: brand?.canonicalName || null,
      canonicalModel: model?.canonicalName || null,
      canonicalGeneration: generation?.name || null,
      canonicalFacelift: facelift.name,
      status: facelift.status,
      sourceIds: sourceIds(facelift),
    };
    const faceliftSafe = safeStatus(facelift) && safeStatus(generation) && safeStatus(model) && safeStatus(brand);
    entries.push({ ...base, term: facelift.name, key: normalizeTerm(facelift.name), kind: "facelift", safe: faceliftSafe, sourceIds: sourceIds(facelift) });
    entries.push(...aliasEntries(facelift, base, facelift.aliases, faceliftSafe));
  }
  for (const variant of data.records.variant) {
    const generation = indexes.generations.get(variant.generationId);
    const model = indexes.models.get(variant.modelId);
    const brand = indexes.brands.get(model?.brandId);
    const facelift = variant.faceliftId ? indexes.facelifts.get(variant.faceliftId) : null;
    const base = {
      entityType: "variant",
      entityId: variant.id,
      brandId: model?.brandId || null,
      modelId: variant.modelId,
      generationId: variant.generationId,
      faceliftId: variant.faceliftId || null,
    };
    const evidence = sourceIds(variant);
    const specs = Object.fromEntries(VARIANT_SPEC_FIELDS.filter((field) => isPresent(variant[field])).map((field) => [field, variant[field]]));
    entities[variant.id] = {
      entityType: "variant",
      entityId: variant.id,
      brandId: model?.brandId || null,
      modelId: variant.modelId,
      generationId: variant.generationId,
      faceliftId: variant.faceliftId || null,
      canonicalMake: brand?.canonicalName || null,
      canonicalModel: model?.canonicalName || null,
      canonicalGeneration: generation?.name || null,
      canonicalFacelift: facelift?.name || null,
      canonicalVariant: variant.name,
      status: variant.status,
      sourceIds: evidence,
      specs,
    };
    const variantSafe = safeStatus(variant) && (!facelift || safeStatus(facelift)) && safeStatus(generation) && safeStatus(model) && safeStatus(brand);
    entries.push({ ...base, term: variant.name, key: normalizeTerm(variant.name), kind: "variant", safe: variantSafe, sourceIds: evidence });
    if (model) {
      const modelVariant = `${model.canonicalName} ${variant.name}`;
      entries.push({ ...base, term: modelVariant, key: normalizeTerm(modelVariant), kind: "canonical_model_variant", safe: variantSafe, sourceIds: [...new Set([...sourceIds(model), ...evidence])] });
      if (brand) {
        const makeModelVariant = `${brand.canonicalName} ${modelVariant}`;
        entries.push({ ...base, term: makeModelVariant, key: normalizeTerm(makeModelVariant), kind: "canonical_make_model_variant", safe: variantSafe, sourceIds: [...new Set([...sourceIds(brand), ...sourceIds(model), ...evidence])] });
      }
    }
    entries.push(...aliasEntries(variant, base, variant.aliases, variantSafe));
  }

  const deduplicated = new Map();
  for (const entry of entries) {
    const identity = `${entry.entityType}|${entry.entityId}|${entry.kind}|${entry.key}`;
    const current = deduplicated.get(identity);
    if (!current) deduplicated.set(identity, entry);
    else current.sourceIds = [...new Set([...(current.sourceIds || []), ...(entry.sourceIds || [])])];
  }
  const indexedEntries = [...deduplicated.values()];
  indexedEntries.sort((left, right) => left.key.localeCompare(right.key) || left.entityType.localeCompare(right.entityType) || left.entityId.localeCompare(right.entityId) || left.kind.localeCompare(right.kind));
  const collisionMap = new Map();
  for (const entry of indexedEntries.filter((row) => row.safe)) {
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
  return { schemaVersion: 2, entities, entries: indexedEntries, collisions };
}

function score(entry, requested) {
  if (entry.key === requested) {
    if (!entry.safe) return 70;
    if (entry.kind === "canonical_make_model_variant") return 130;
    if (entry.kind === "canonical_model_variant") return 128;
    if (entry.kind === "canonical_make_model_generation") return 126;
    if (entry.kind === "canonical_model_generation") return 124;
    if (entry.kind === "canonical_make_model") return 120;
    if (entry.kind === "canonical") return 115;
    if (entry.kind === "variant") return 112;
    if (entry.kind === "platform_code") return 110;
    return 105;
  }
  if (entry.key.startsWith(requested)) return entry.safe ? 80 - Math.min(20, entry.key.length - requested.length) : 45;
  if (requested.length >= 3 && entry.key.includes(requested)) return entry.safe ? 55 - Math.min(20, entry.key.indexOf(requested)) : 30;
  return 0;
}

function requestCandidates(index, requested, scopedBrandIds = null) {
  const candidates = [{ key: requested, brandId: null }];
  for (const brandEntry of index.entries) {
    if (brandEntry.entityType !== "brand" || !brandEntry.safe || requested.length <= brandEntry.key.length || !requested.startsWith(brandEntry.key)) continue;
    if (scopedBrandIds && !scopedBrandIds.has(brandEntry.brandId)) continue;
    candidates.push({ key: requested.slice(brandEntry.key.length), brandId: brandEntry.brandId });
  }
  for (const candidate of [...candidates]) {
    for (const modelEntry of index.entries) {
      if (modelEntry.entityType !== "model" || !modelEntry.safe || !candidate.key.startsWith(modelEntry.key)) continue;
      if (candidate.brandId && candidate.brandId !== modelEntry.brandId) continue;
      if (scopedBrandIds && !scopedBrandIds.has(modelEntry.brandId)) continue;
      const canonicalModel = index.entities?.[modelEntry.entityId]?.canonicalModel;
      const canonicalKey = normalizeTerm(canonicalModel);
      if (!canonicalKey) continue;
      candidates.push({ key: `${canonicalKey}${candidate.key.slice(modelEntry.key.length)}`, brandId: modelEntry.brandId });
    }
  }
  return [...new Map(candidates.map((candidate) => [`${candidate.brandId || "*"}|${candidate.key}`, candidate])).values()];
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
  const requestedCandidates = requestCandidates(index, requested, brandIds);
  const bestByEntity = new Map();
  for (const entry of index.entries) {
    if (brandIds && !brandIds.has(entry.brandId)) continue;
    const value = Math.max(0, ...requestedCandidates
      .filter((candidate) => !candidate.brandId || candidate.brandId === entry.brandId)
      .map((candidate) => score(entry, candidate.key)));
    if (!value) continue;
    const current = bestByEntity.get(entry.entityId);
    if (!current || value > current.score || (value === current.score && entry.kind < current.entry.kind)) bestByEntity.set(entry.entityId, { entry, score: value });
  }
  const matches = [...bestByEntity.values()]
    .sort((left, right) => right.score - left.score || left.entry.entityType.localeCompare(right.entry.entityType) || left.entry.entityId.localeCompare(right.entry.entityId))
    .slice(0, Math.max(1, Number(limit) || 20))
    .map((match) => ({ ...match, canonical: index.entities?.[match.entry.entityId] || null }));
  const topScore = matches[0]?.score || 0;
  const top = matches.filter((row) => row.score === topScore);
  const identities = new Set(top.map((row) => row.entry.entityType === "variant" ? row.entry.entityId : row.entry.modelId || row.entry.entityId));
  const ambiguous = topScore >= 100 && identities.size > 1;
  const resolved = !ambiguous && top.length && top[0].entry.safe && topScore >= 100 ? top[0] : null;
  return { query: String(query), normalized: requested, resolved, ambiguous, matches };
}

function safeBrandIds(index, make) {
  const key = normalizeTerm(make);
  return new Set(index.entries.filter((entry) => entry.entityType === "brand" && entry.safe && entry.key === key).map((entry) => entry.brandId));
}

function sourcePrefixedModelCandidate(index, title) {
  const titleKey = normalizeTerm(title);
  if (!titleKey) return null;
  const candidates = new Map();
  for (const entry of index.entries) {
    if (entry.entityType !== "model" || !entry.safe || entry.key.length < 4 || titleKey.length <= entry.key.length || !titleKey.endsWith(entry.key)) continue;
    const current = candidates.get(entry.entityId);
    if (!current || entry.key.length > current.key.length) candidates.set(entry.entityId, entry);
  }
  const longest = Math.max(0, ...[...candidates.values()].map((entry) => entry.key.length));
  const matches = [...candidates.values()].filter((entry) => entry.key.length === longest);
  if (matches.length !== 1) return null;
  return index.entities?.[matches[0].entityId] || null;
}

export function resolveVehicleIdentity(index, input = {}) {
  const make = String(input.make || "").trim();
  const model = String(input.model || "").trim();
  const variant = String(input.variant || input.trim || input.version || "").trim();
  const title = String(input.title || "").trim();
  const brandIds = make ? safeBrandIds(index, make) : new Set();
  const makeKnown = !make || brandIds.size > 0;
  const queries = [];
  if (title) queries.push(title);
  if (make && model && variant) queries.push(`${make} ${model} ${variant}`);
  if (model && variant) queries.push(`${model} ${variant}`);
  if (make && model) queries.push(`${make} ${model}`);
  if (model) queries.push(model);
  const uniqueQueries = [...new Set(queries.filter(Boolean))];

  if (makeKnown) {
    for (const query of uniqueQueries) {
      const result = resolveSearch(index, query, make ? { make } : {});
      if (result.resolved && result.resolved.entry.entityType !== "brand") {
        return {
          input: { ...input },
          status: "resolved",
          reason: null,
          resolved: result.resolved.canonical,
          match: result.resolved,
          candidate: null,
          ambiguous: false,
        };
      }
      if (result.ambiguous) {
        return {
          input: { ...input },
          status: "ambiguous",
          reason: "multiple_exact_identities",
          resolved: null,
          match: null,
          candidate: null,
          ambiguous: true,
        };
      }
    }
  }

  const fallbackQueries = [model && variant ? `${model} ${variant}` : null, model, title].filter(Boolean);
  for (const query of [...new Set(fallbackQueries)]) {
    const candidate = resolveSearch(index, query);
    if (candidate.resolved && candidate.resolved.entry.entityType !== "brand") {
      return {
        input: { ...input },
        status: make ? "make_conflict" : "candidate",
        reason: make ? "source_make_not_proven_for_canonical_brand" : "candidate_requires_review",
        resolved: null,
        match: null,
        candidate: candidate.resolved.canonical,
        ambiguous: false,
      };
    }
    if (candidate.ambiguous) {
      return {
        input: { ...input },
        status: "ambiguous",
        reason: "multiple_exact_identities",
        resolved: null,
        match: null,
        candidate: null,
        ambiguous: true,
      };
    }
  }

  const titleCandidate = sourcePrefixedModelCandidate(index, title);
  if (titleCandidate) {
    return {
      input: { ...input },
      status: "make_conflict",
      reason: "title_prefix_not_proven_for_canonical_brand",
      resolved: null,
      match: null,
      candidate: titleCandidate,
      ambiguous: false,
    };
  }

  return {
    input: { ...input },
    status: "unresolved",
    reason: "no_exact_source_backed_identity",
    resolved: null,
    match: null,
    candidate: null,
    ambiguous: false,
  };
}

async function main() {
  const query = process.argv.slice(2).filter((arg) => !arg.startsWith("--"))[0];
  const makeArg = process.argv.find((arg) => arg.startsWith("--make="));
  if (!query) throw new Error("Usage: node scripts/vehicle-encyclopedia/search.mjs <query> [--make=Brand]");
  const index = await readJson(path.join(WORKSPACE_ROOT, "generated/search-index.json"));
  console.log(JSON.stringify(resolveSearch(index, query, { make: makeArg?.slice("--make=".length) }), null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
