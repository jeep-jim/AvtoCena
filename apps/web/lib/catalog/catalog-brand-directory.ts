import {
  CATALOG_BRANDS,
  canonicalCatalogBrand,
  catalogBrandBySlug,
  catalogBrandSlug,
  type CatalogBrand,
} from "./brands";
import { readEncyclopediaIdentityDataset } from "./encyclopedia-identity-data";
import { EncyclopediaIdentitySlugResolver } from "./encyclopedia-identity-slugs";
import { readSourceBackedEncyclopediaModels } from "./knowledge-source-master";

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function safeAliasValues(rows: any) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && row.safe === true && clean(row.value))
    .map((row) => clean(row.value));
}

function toBrand(name: string, slug = catalogBrandSlug(name), aliases: string[] = []): CatalogBrand {
  return { name, slug, dromSlug: slug, aliases };
}

/**
 * One public brand directory for the complete saved knowledge corpus.
 *
 * V2 remains canonical authority where it has a match. Source-master brands
 * remain visible while they wait for a V2 link. Raw live parser strings are
 * deliberately NOT allowed to create encyclopedia brands: that was the source
 * of entries such as "212" and other catalog garbage.
 */
export async function readCatalogBrandDirectory() {
  const [dataset, sourceModels] = await Promise.all([
    readEncyclopediaIdentityDataset(),
    readSourceBackedEncyclopediaModels(),
  ]);
  const brands = new Map<string, CatalogBrand>();
  const add = (brand: CatalogBrand) => {
    const key = brand.slug || catalogBrandSlug(brand.name);
    const current = brands.get(key);
    brands.set(key, current ? {
      ...brand,
      ...current,
      aliases: [...new Set([...(current.aliases || []), ...(brand.aliases || [])])],
    } : brand);
  };

  for (const brand of CATALOG_BRANDS) {
    const publicName = canonicalCatalogBrand(brand.name);
    add({
      ...brand,
      name: publicName,
      slug: catalogBrandSlug(publicName),
      aliases: [...new Set([brand.name, ...(brand.aliases || [])])],
    });
  }
  for (const brand of dataset?.brands || []) {
    const publicName = canonicalCatalogBrand(brand.canonicalName);
    add(toBrand(publicName, catalogBrandSlug(publicName), [
      brand.canonicalName,
      clean(brand.slug),
      ...safeAliasValues(brand.aliases),
    ].filter(Boolean)));
  }
  for (const model of sourceModels) {
    const publicName = canonicalCatalogBrand(model.make);
    if (!publicName) continue;
    add(toBrand(publicName, catalogBrandSlug(publicName), [model.make]));
  }

  return [...brands.values()].sort((left, right) => left.name.localeCompare(right.name, "ru"));
}

export async function resolveCatalogBrandBySlug(rawSlug: string): Promise<CatalogBrand | null> {
  const slug = catalogBrandSlug(rawSlug);
  const legacy = catalogBrandBySlug(rawSlug);
  if (legacy) return legacy;

  const dataset = await readEncyclopediaIdentityDataset();
  if (dataset) {
    const match = new EncyclopediaIdentitySlugResolver(dataset).resolveBrand(rawSlug);
    if (match) {
      const source = dataset.brands.find((brand) => brand.id === match.brandId);
      const publicName = canonicalCatalogBrand(match.canonicalName);
      return toBrand(publicName, catalogBrandSlug(publicName), [match.canonicalName, match.canonicalSlug, ...safeAliasValues(source?.aliases)]);
    }
  }

  return (await readCatalogBrandDirectory()).find((brand) => brand.slug === slug) || null;
}

export function catalogBrandMatches(brand: CatalogBrand, rawMake: unknown) {
  const raw = clean(rawMake);
  if (!raw) return false;
  const sourceSlugs = new Set([raw, canonicalCatalogBrand(raw)]
    .filter(Boolean)
    .map((candidate) => catalogBrandSlug(canonicalCatalogBrand(candidate))));
  const brandSlugs = new Set([brand.name, brand.slug, ...(brand.aliases || [])]
    .filter(Boolean)
    .map((candidate) => catalogBrandSlug(canonicalCatalogBrand(candidate))));
  return [...sourceSlugs].some((candidate) => brandSlugs.has(candidate));
}
