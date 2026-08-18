export type EncyclopediaAlias = string | {
  value: string;
  safe?: boolean;
  kind?: string;
  language?: string;
  market?: string;
};

export type EncyclopediaBrandIdentity = {
  id: string;
  canonicalName: string;
  slug?: string;
  aliases?: EncyclopediaAlias[];
};

export type EncyclopediaModelIdentity = {
  id: string;
  brandId: string;
  canonicalName: string;
  slug?: string;
  aliases?: EncyclopediaAlias[];
  sourceNames?: EncyclopediaAlias[];
};

export type EncyclopediaSearchIdentityEntry = {
  entityType: "brand" | "model" | "generation" | "facelift" | "variant" | string;
  entityId: string;
  brandId?: string | null;
  modelId?: string | null;
  term: string;
  key?: string;
  kind?: string;
  safe?: boolean;
};

export type CatalogIdentitySource = "canonical" | "safe_alias" | "search_index" | "unresolved";

export type CatalogIdentityResolution = {
  rawMake: string;
  rawModel: string;
  brandId: string | null;
  modelId: string | null;
  canonicalMake: string;
  canonicalModel: string;
  makeSource: CatalogIdentitySource;
  modelSource: CatalogIdentitySource;
  resolved: boolean;
  ambiguous: boolean;
};

export type EncyclopediaIdentityCollision = {
  scope: "brand" | "model";
  key: string;
  entityIds: string[];
};

type Candidate = { entityId: string; source: Exclude<CatalogIdentitySource, "unresolved"> };

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/**
 * Must stay Unicode-aware: Chinese, Korean and Japanese aliases are first-class
 * identity evidence in Encyclopedia V2. Semantic symbols that distinguish
 * real model names must be expanded before generic punctuation is removed.
 */
export function encyclopediaIdentityKey(value: unknown) {
  return clean(value)
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/ё/g, "е")
    .replace(/&/g, "and")
    .replace(/\+/g, "plus")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function aliasValue(alias: EncyclopediaAlias) {
  return typeof alias === "string" ? alias : alias?.value;
}

/**
 * Fail closed. V2's canonical identity contract uses structured aliases with an
 * explicit safe flag. Raw string aliases and sourceNames are discovery/audit
 * material only and must not silently become merge authority.
 */
function aliasSafe(alias: EncyclopediaAlias) {
  return typeof alias !== "string" && alias?.safe === true;
}

function addCandidate(map: Map<string, Candidate[]>, rawKey: string, candidate: Candidate) {
  const key = encyclopediaIdentityKey(rawKey);
  if (!key) return;
  const current = map.get(key) || [];
  if (!current.some((item) => item.entityId === candidate.entityId && item.source === candidate.source)) current.push(candidate);
  map.set(key, current);
}

function uniqueCandidate(candidates: Candidate[] | undefined) {
  if (!candidates?.length) return null;
  const entityIds = [...new Set(candidates.map((candidate) => candidate.entityId))];
  if (entityIds.length !== 1) return null;
  const preferred = candidates.find((candidate) => candidate.source === "canonical")
    || candidates.find((candidate) => candidate.source === "safe_alias")
    || candidates[0];
  return preferred || null;
}

export class EncyclopediaIdentityResolver {
  private brands = new Map<string, EncyclopediaBrandIdentity>();
  private models = new Map<string, EncyclopediaModelIdentity>();
  private brandKeys = new Map<string, Candidate[]>();
  private modelKeysByBrand = new Map<string, Map<string, Candidate[]>>();
  readonly collisions: EncyclopediaIdentityCollision[];

  constructor(input: {
    brands: EncyclopediaBrandIdentity[];
    models: EncyclopediaModelIdentity[];
    searchEntries?: EncyclopediaSearchIdentityEntry[];
  }) {
    for (const brand of input.brands || []) {
      if (!brand?.id || !clean(brand.canonicalName)) continue;
      this.brands.set(brand.id, brand);
      addCandidate(this.brandKeys, brand.canonicalName, { entityId: brand.id, source: "canonical" });
      for (const alias of brand.aliases || []) {
        if (aliasSafe(alias)) addCandidate(this.brandKeys, aliasValue(alias), { entityId: brand.id, source: "safe_alias" });
      }
    }

    for (const model of input.models || []) {
      if (!model?.id || !model.brandId || !clean(model.canonicalName) || !this.brands.has(model.brandId)) continue;
      this.models.set(model.id, model);
      const map = this.modelMap(model.brandId);
      addCandidate(map, model.canonicalName, { entityId: model.id, source: "canonical" });
      for (const alias of model.aliases || []) {
        if (aliasSafe(alias)) addCandidate(map, aliasValue(alias), { entityId: model.id, source: "safe_alias" });
      }
    }

    for (const entry of input.searchEntries || []) {
      if (!entry?.safe || !clean(entry.term)) continue;
      if (entry.entityType === "brand" && entry.brandId && this.brands.has(entry.brandId)) {
        addCandidate(this.brandKeys, entry.term, { entityId: entry.brandId, source: "search_index" });
      }
      if (entry.entityType === "model" && entry.brandId && entry.modelId && this.models.has(entry.modelId)) {
        addCandidate(this.modelMap(entry.brandId), entry.term, { entityId: entry.modelId, source: "search_index" });
      }
    }

    this.collisions = this.collectCollisions();
  }

  private modelMap(brandId: string) {
    let map = this.modelKeysByBrand.get(brandId);
    if (!map) {
      map = new Map<string, Candidate[]>();
      this.modelKeysByBrand.set(brandId, map);
    }
    return map;
  }

  private collectCollisions() {
    const collisions: EncyclopediaIdentityCollision[] = [];
    for (const [key, candidates] of this.brandKeys) {
      const entityIds = [...new Set(candidates.map((candidate) => candidate.entityId))];
      if (entityIds.length > 1) collisions.push({ scope: "brand", key, entityIds: entityIds.sort() });
    }
    for (const [brandId, map] of this.modelKeysByBrand) {
      for (const [key, candidates] of map) {
        const entityIds = [...new Set(candidates.map((candidate) => candidate.entityId))];
        if (entityIds.length > 1) collisions.push({ scope: "model", key: `${brandId}:${key}`, entityIds: entityIds.sort() });
      }
    }
    return collisions.sort((left, right) => `${left.scope}:${left.key}`.localeCompare(`${right.scope}:${right.key}`, "en"));
  }

  resolveBrand(rawMake: unknown) {
    const raw = clean(rawMake);
    const candidate = uniqueCandidate(this.brandKeys.get(encyclopediaIdentityKey(raw)));
    if (!candidate) return null;
    const brand = this.brands.get(candidate.entityId);
    return brand ? { brand, source: candidate.source } : null;
  }

  resolveModel(brandId: string, rawModel: unknown) {
    const raw = clean(rawModel);
    const candidate = uniqueCandidate(this.modelKeysByBrand.get(brandId)?.get(encyclopediaIdentityKey(raw)));
    if (!candidate) return null;
    const model = this.models.get(candidate.entityId);
    return model ? { model, source: candidate.source } : null;
  }

  resolve(input: { make?: unknown; model?: unknown }): CatalogIdentityResolution {
    const rawMake = clean(input.make);
    const rawModel = clean(input.model);
    const brandMatch = this.resolveBrand(rawMake);
    if (!brandMatch) {
      const makeCandidates = this.brandKeys.get(encyclopediaIdentityKey(rawMake)) || [];
      return {
        rawMake,
        rawModel,
        brandId: null,
        modelId: null,
        canonicalMake: rawMake,
        canonicalModel: rawModel,
        makeSource: "unresolved",
        modelSource: "unresolved",
        resolved: false,
        ambiguous: new Set(makeCandidates.map((candidate) => candidate.entityId)).size > 1,
      };
    }

    const modelMatch = rawModel ? this.resolveModel(brandMatch.brand.id, rawModel) : null;
    const modelCandidates = rawModel
      ? this.modelKeysByBrand.get(brandMatch.brand.id)?.get(encyclopediaIdentityKey(rawModel)) || []
      : [];

    return {
      rawMake,
      rawModel,
      brandId: brandMatch.brand.id,
      modelId: modelMatch?.model.id || null,
      canonicalMake: brandMatch.brand.canonicalName,
      canonicalModel: modelMatch?.model.canonicalName || rawModel,
      makeSource: brandMatch.source,
      modelSource: modelMatch?.source || "unresolved",
      resolved: Boolean(modelMatch || !rawModel),
      ambiguous: !modelMatch && new Set(modelCandidates.map((candidate) => candidate.entityId)).size > 1,
    };
  }
}
