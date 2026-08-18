import type { EncyclopediaAlias, EncyclopediaBrandIdentity, EncyclopediaModelIdentity } from "./encyclopedia-identity";
import type { EncyclopediaIdentityDataset } from "./encyclopedia-identity-data";

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function encyclopediaIdentitySlug(value: unknown) {
  return clean(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function safeAsciiAliases(aliases: EncyclopediaAlias[] | undefined) {
  return (aliases || [])
    .filter((alias): alias is Exclude<EncyclopediaAlias, string> => typeof alias === "object" && Boolean(alias) && alias.safe === true)
    .map((alias) => clean(alias.value))
    .filter((value) => value && /^[\x20-\x7E]+$/.test(value));
}

type BrandSlugMatch = {
  brandId: string;
  canonicalName: string;
  canonicalSlug: string;
  matchedSlug: string;
  canonical: boolean;
};

type ModelSlugMatch = {
  modelId: string;
  brandId: string;
  canonicalName: string;
  canonicalSlug: string;
  matchedSlug: string;
  canonical: boolean;
};

function addUnique<T extends { brandId?: string; modelId?: string }>(map: Map<string, T[]>, slug: string, value: T) {
  if (!slug) return;
  const rows = map.get(slug) || [];
  const key = value.modelId || value.brandId || "";
  if (!rows.some((row) => (row.modelId || row.brandId || "") === key)) rows.push(value);
  map.set(slug, rows);
}

function unique<T>(rows: T[] | undefined) {
  return rows?.length === 1 ? rows[0] : null;
}

/**
 * Canonical SEO routing derived only from V2 canonical slugs and safe ASCII
 * aliases. Localized aliases remain search terms; they are not guessed into
 * Latin URL slugs. Any alias-slug collision fails closed.
 */
export class EncyclopediaIdentitySlugResolver {
  private brandSlugs = new Map<string, BrandSlugMatch[]>();
  private modelSlugsByBrand = new Map<string, Map<string, ModelSlugMatch[]>>();

  constructor(dataset: Pick<EncyclopediaIdentityDataset, "brands" | "models">) {
    const brands = new Map(dataset.brands.map((brand) => [brand.id, brand]));
    for (const brand of dataset.brands) this.addBrand(brand);
    for (const model of dataset.models) {
      if (!brands.has(model.brandId)) continue;
      this.addModel(model);
    }
  }

  private addBrand(brand: EncyclopediaBrandIdentity) {
    const canonicalSlug = clean(brand.slug) || encyclopediaIdentitySlug(brand.canonicalName);
    if (!canonicalSlug) return;
    addUnique(this.brandSlugs, canonicalSlug, {
      brandId: brand.id,
      canonicalName: brand.canonicalName,
      canonicalSlug,
      matchedSlug: canonicalSlug,
      canonical: true,
    });
    for (const alias of safeAsciiAliases(brand.aliases)) {
      const slug = encyclopediaIdentitySlug(alias);
      if (!slug || slug === canonicalSlug) continue;
      addUnique(this.brandSlugs, slug, {
        brandId: brand.id,
        canonicalName: brand.canonicalName,
        canonicalSlug,
        matchedSlug: slug,
        canonical: false,
      });
    }
  }

  private addModel(model: EncyclopediaModelIdentity) {
    const canonicalSlug = clean(model.slug) || encyclopediaIdentitySlug(model.canonicalName);
    if (!canonicalSlug) return;
    let map = this.modelSlugsByBrand.get(model.brandId);
    if (!map) {
      map = new Map();
      this.modelSlugsByBrand.set(model.brandId, map);
    }
    addUnique(map, canonicalSlug, {
      modelId: model.id,
      brandId: model.brandId,
      canonicalName: model.canonicalName,
      canonicalSlug,
      matchedSlug: canonicalSlug,
      canonical: true,
    });
    for (const alias of safeAsciiAliases(model.aliases)) {
      const slug = encyclopediaIdentitySlug(alias);
      if (!slug || slug === canonicalSlug) continue;
      addUnique(map, slug, {
        modelId: model.id,
        brandId: model.brandId,
        canonicalName: model.canonicalName,
        canonicalSlug,
        matchedSlug: slug,
        canonical: false,
      });
    }
  }

  resolveBrand(slug: unknown) {
    return unique(this.brandSlugs.get(encyclopediaIdentitySlug(slug)));
  }

  resolveModel(brandId: string, slug: unknown) {
    return unique(this.modelSlugsByBrand.get(brandId)?.get(encyclopediaIdentitySlug(slug)));
  }

  canonicalBrandPath(match: BrandSlugMatch) {
    return `/cars/brand/${match.canonicalSlug}`;
  }

  canonicalModelPath(brand: BrandSlugMatch, model: ModelSlugMatch) {
    return `/cars/brand/${brand.canonicalSlug}/model/${model.canonicalSlug}`;
  }
}
