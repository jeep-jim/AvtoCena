import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, readJson, writeJson } from "./lib.mjs";

const REPO_ROOT = path.resolve(WORKSPACE_ROOT, "../../..");
const OUTPUT = path.join(WORKSPACE_ROOT, "reports/brand-publication-readiness.json");
const ASSET_REPORT = path.join(WORKSPACE_ROOT, "reports/brand-logo-assets.json");

function catalogBrands(source) {
  const body = source.match(/const DROM_BRAND_NAMES = \[([\s\S]*?)\] as const;/)?.[1];
  if (!body) throw new Error("DROM_BRAND_NAMES was not found in apps/web/lib/catalog/brands.ts");
  return [...body.matchAll(/"((?:\\.|[^"\\])*)"/g)].map((match) => JSON.parse(`"${match[1]}"`));
}

function hasNonLatinPublicScript(value) {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}]/u.test(value);
}

function pngSize(buffer) {
  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a" || buffer.length < 33) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), colorType: buffer[25] };
}

async function checkAsset(media) {
  if (!media) return { exists: false, exactFormat: false, checksumMatches: false };
  try {
    const file = path.join(WORKSPACE_ROOT, media.assetPath);
    const buffer = await readFile(file);
    const size = pngSize(buffer);
    return {
      exists: true,
      exactFormat: size?.width === 90 && size?.height === 60 && [4, 6].includes(size?.colorType),
      checksumMatches: createHash("sha256").update(buffer).digest("hex") === media.sha256,
      widthPx: size?.width || null,
      heightPx: size?.height || null,
      pngColorType: size?.colorType ?? null,
    };
  } catch {
    return { exists: false, exactFormat: false, checksumMatches: false };
  }
}

export async function auditBrandReadiness({ root = WORKSPACE_ROOT } = {}) {
  const [workspace, brandsSource, assetReport] = await Promise.all([
    loadWorkspace(root),
    readFile(path.join(REPO_ROOT, "apps/web/lib/catalog/brands.ts"), "utf8"),
    readJson(path.join(root, "reports/brand-logo-assets.json")),
  ]);
  const productionNames = new Set(catalogBrands(brandsSource));
  const productionKeys = new Set(
    workspace.records.brand
      .filter((brand) => productionNames.has(brand.canonicalName) || (brand.aliases || []).some((alias) => productionNames.has(alias.value)))
      .map((brand) => brand.id),
  );
  const mediaByOwner = new Map();
  for (const media of workspace.records.media.filter((item) => item.role === "brand_logo")) {
    const themes = mediaByOwner.get(media.ownerId) || new Map();
    themes.set(media.theme, media);
    mediaByOwner.set(media.ownerId, themes);
  }

  const brands = [];
  for (const brand of [...workspace.records.brand].sort((left, right) => left.canonicalName.localeCompare(right.canonicalName, "en"))) {
    const themes = mediaByOwner.get(brand.id) || new Map();
    const darkMedia = themes.get("dark");
    const lightMedia = themes.get("light");
    const [darkAsset, lightAsset] = await Promise.all([checkAsset(darkMedia), checkAsset(lightMedia)]);
    const canonicalEvidence = (brand.evidence || []).some(
      (item) => item.status === "verified" && item.fields.includes("canonicalName"),
    );
    const latinCanonicalName = !hasNonLatinPublicScript(brand.canonicalName);
    const identityReady = brand.status === "verified" && brand.countries.length > 0 && canonicalEvidence && latinCanonicalName;
    const technicalLogoReady = [darkMedia, lightMedia].every(Boolean)
      && [darkAsset, lightAsset].every((item) => item.exists && item.exactFormat && item.checksumMatches);
    const logoPublicationApproved = [darkMedia, lightMedia].every(
      (item) => item?.status === "approved" && item?.rightsStatus === "cleared" && item?.identityStatus === "exact_brand",
    );
    const blockers = [];
    if (!canonicalEvidence) blockers.push("canonical-identity-evidence-missing");
    if (!latinCanonicalName) blockers.push("canonical-name-not-english-latin");
    if (!brand.countries.length) blockers.push("country-review-missing");
    if (brand.status !== "verified") blockers.push("identity-alias-review-incomplete");
    if (!darkMedia) blockers.push("dark-logo-missing");
    if (!lightMedia) blockers.push("light-logo-missing");
    if ((darkMedia && !darkAsset.exactFormat) || (lightMedia && !lightAsset.exactFormat)) blockers.push("logo-format-invalid");
    if ((darkMedia && !darkAsset.checksumMatches) || (lightMedia && !lightAsset.checksumMatches)) blockers.push("logo-checksum-mismatch");
    if (technicalLogoReady && !logoPublicationApproved) blockers.push("logo-source-rights-review-incomplete");
    brands.push({
      brandId: brand.id,
      brand: brand.canonicalName,
      slug: brand.slug,
      denominatorSource: productionKeys.has(brand.id) ? "production-static-baseline" : "official-portfolio-expansion",
      identity: {
        recordStatus: brand.status,
        canonicalEvidence,
        latinCanonicalName,
        countryReviewed: brand.countries.length > 0,
        aliasCount: (brand.aliases || []).length,
        ready: identityReady,
      },
      logos: {
        dark: darkMedia ? { mediaId: darkMedia.id, status: darkMedia.status, rightsStatus: darkMedia.rightsStatus, ...darkAsset } : null,
        light: lightMedia ? { mediaId: lightMedia.id, status: lightMedia.status, rightsStatus: lightMedia.rightsStatus, ...lightAsset } : null,
        technicalReady: technicalLogoReady,
        publicationApproved: logoPublicationApproved,
      },
      publicationReady: identityReady && technicalLogoReady && logoPublicationApproved,
      blockers,
    });
  }

  const report = {
    schemaVersion: 1,
    generatedFrom: [
      "apps/web/lib/catalog/brands.ts",
      "vehicle-encyclopedia-v2 canonical brand/media/source chunks",
      "reports/brand-logo-assets.json",
    ],
    productionConnected: false,
    denominator: {
      state: "expanding",
      currentStagedBrands: brands.length,
      productionStaticBaselineBrands: brands.filter((row) => row.denominatorSource === "production-static-baseline").length,
      officialPortfolioExpansionBrands: brands.filter((row) => row.denominatorSource === "official-portfolio-expansion").length,
      parserObservedMakeInventoryImported: "partial-repository-audit-only",
      officialGlobalPortfolioAuditComplete: false,
      completionClaimAllowed: false,
      note: "The current total is a verified checkpoint, not the final global denominator. Every parser make inventory and remaining official portfolios still have to be reconciled.",
    },
    logoStandard: assetReport.standard,
    totals: {
      identityReady: brands.filter((row) => row.identity.ready).length,
      technicalLogoPairsReady: brands.filter((row) => row.logos.technicalReady).length,
      missingTechnicalLogoPairs: brands.filter((row) => !row.logos.technicalReady).length,
      logoPublicationApproved: brands.filter((row) => row.logos.publicationApproved).length,
      publicationReady: brands.filter((row) => row.publicationReady).length,
      stagedAssetPairsWithoutV2Owner: (assetReport.assets || []).filter((asset) => !workspace.records.brand.some((brand) => brand.slug === asset.slug)).length,
    },
    stagedAssetPairsWithoutV2Owner: (assetReport.assets || [])
      .filter((asset) => !workspace.records.brand.some((brand) => brand.slug === asset.slug))
      .map((asset) => asset.slug),
    rule: "No brand or vehicle under it may be published until source-backed identity/alias review, exact 90x60 light/dark assets, checksum integrity and explicit logo rights approval all pass.",
    brands,
  };
  return report;
}

async function main() {
  const report = await auditBrandReadiness();
  await writeJson(OUTPUT, report);
  console.log(JSON.stringify({ denominator: report.denominator, totals: report.totals }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
