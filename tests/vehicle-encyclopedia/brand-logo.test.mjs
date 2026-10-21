import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");
const assetReport = await readJson(path.join(DATA_ROOT, "reports/brand-logo-assets.json"));
const readiness = await readJson(path.join(DATA_ROOT, "reports/brand-publication-readiness.json"));
const workspace = await loadWorkspace(DATA_ROOT);

function pngInfo(buffer) {
  assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), colorType: buffer[25] };
}

test("every normalized staging logo is an exact transparent 90x60 PNG", async () => {
  assert.deepEqual(assetReport.outputs, {
    outputRoot: "data/catalog/vehicle-encyclopedia-v2/assets/brand-logos",
    outputFiles: 410,
    brandAssets: 204,
    completeThemePairs: 204,
    exactFormatPairs: 204,
    sourceTraceCompletePairs: 194,
    fallbackFreePairs: 194,
  });
  for (const asset of assetReport.assets) {
    assert.equal(asset.pairComplete, true);
    assert.equal(asset.formatReady, true);
    for (const theme of ["dark", "light"]) {
      const item = asset.themes[theme];
      const buffer = await readFile(path.join(DATA_ROOT, item.assetPath));
      const png = pngInfo(buffer);
      assert.deepEqual({ width: png.width, height: png.height }, { width: 90, height: 60 });
      assert([4, 6].includes(png.colorType));
      assert.equal(createHash("sha256").update(buffer).digest("hex"), item.sha256);
    }
  }
});

test("source-traced logo pairs are owned by exactly 195 V2 brands", () => {
  const logos = workspace.records.media.filter((media) => media.role === "brand_logo");
  assert.equal(logos.length, 390);
  const owners = new Map();
  for (const logo of logos) {
    const themes = owners.get(logo.ownerId) || new Set();
    themes.add(logo.theme);
    owners.set(logo.ownerId, themes);
    assert.equal(logo.widthPx, 90);
    assert.equal(logo.heightPx, 60);
    assert.equal(logo.identityStatus, "exact_brand");
    assert.equal(logo.status, "review");
    assert.equal(logo.rightsStatus, "review_required");
  }
  assert.equal(owners.size, 195);
  for (const themes of owners.values()) assert.deepEqual([...themes].sort(), ["dark", "light"]);
});

test("publication report blocks incomplete identities, logos and rights review", () => {
  assert.deepEqual(readiness.totals, {
    identityReady: 9,
    technicalLogoPairsReady: 195,
    missingTechnicalLogoPairs: 60,
    logoPublicationApproved: 0,
    publicationReady: 0,
    stagedAssetPairsWithoutV2Owner: 3,
  });
  assert.deepEqual(
    readiness.brands.filter((row) => !row.logos.technicalReady).map((row) => row.brand),
    [
      "AION", "Aiways", "Alpine", "ARCFOX", "AUDI China", "Brabus", "Bugatti", "Caterham", "CIIMO", "Cirelli",
      "Dallara", "DFSK", "Dongfeng Aeolus", "Dongfeng eπ", "Dongfeng Nammi", "Donkervoort",
      "DR", "DS Automobiles", "e.GO", "EBRO", "Elaris", "EMC", "EVO", "Exlantix",
      "FANGCHENGBAO", "Farizon", "firefly", "Geely Galaxy", "HEDMOS", "HYPTEC", "iCAUR", "INEOS",
      "JAC Yiwei", "JMEV", "KTM", "Kuayue", "Lada", "LEPAS", "LEVC", "LUXEED", "Mahindra", "MAN", "Micro", "Mobilize", "Moke", "ONVO",
      "RADAR", "RUF", "SECMA", "SHANGJIE", "Skyworth", "Sportequipe",
      "SRM Shineray", "STELATO", "Suda", "Togg", "VinFast", "YANGWANG", "Yudo", "Zhidou",
    ],
  );
  assert.deepEqual(readiness.stagedAssetPairsWithoutV2Owner, [
    "barkas", "delorean", "tatra",
  ]);
});

test("parser and raw-logo candidates remain explicit denominator work", async () => {
  const report = await readJson(path.join(DATA_ROOT, "reports/brand-denominator-candidates.json"));
  assert.deepEqual({
    totalObservations: report.parserMakes.totalObservations,
    uniqueRawMakes: report.parserMakes.uniqueRawMakes,
    resolved: report.parserMakes.resolved,
    ambiguous: report.parserMakes.ambiguous,
    identityReviewRequired: report.parserMakes.identityReviewRequired,
    probableParserNoise: report.parserMakes.probableParserNoise,
  }, {
    totalObservations: 143,
    uniqueRawMakes: 39,
    resolved: 34,
    ambiguous: 0,
    identityReviewRequired: 0,
    probableParserNoise: 5,
  });
  assert.equal(report.rawLogoArchive.archiveFiles, 284);
  assert.equal(report.rawLogoArchive.uniqueLogoIdentities, 198);
  assert.equal(report.logoIdentityCandidates.uniqueCandidates, 8);
  assert.equal(report.completionClaimAllowed, false);
});
