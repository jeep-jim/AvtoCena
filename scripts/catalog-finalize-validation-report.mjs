import fs from "node:fs/promises";
import path from "node:path";

const reportFile = process.env.CATALOG_REBUILD_VALIDATION_REPORT || "catalog-source-scale-validation-report.json";
const markets = String(process.env.CATALOG_REBUILD_MARKETS || "korea,china,japan,uae,europe,georgia,kyrgyzstan")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const expectedArtifactsPerMarket = Math.max(1, Number(process.env.CATALOG_VALIDATION_EXPECTED_ARTIFACTS_PER_MARKET || 1));
const requireVolume = String(process.env.CATALOG_VALIDATION_REQUIRE_VOLUME || "false").toLowerCase() === "true";
const failOnStructural = String(process.env.CATALOG_VALIDATION_FAIL_ON_STRUCTURAL || "false").toLowerCase() === "true";
const failOnNotOk = String(process.env.CATALOG_VALIDATION_FAIL_ON_NOT_OK || "false").toLowerCase() === "true";

const report = JSON.parse(await fs.readFile(reportFile, "utf8"));
const inputDir = report.inputDir || process.env.CATALOG_REBUILD_INPUT_DIR || "catalog-rebuild";
const structuralFailures = new Set();
const payloads = [];

if (Array.isArray(report.fileErrors) && report.fileErrors.length) {
  structuralFailures.add(`generation_file_errors:${report.fileErrors.length}`);
}

let filenames = [];
try {
  filenames = (await fs.readdir(inputDir)).filter((name) => /^catalog-rebuild-.+\.json$/.test(name)).sort();
} catch (error) {
  structuralFailures.add(`input_directory_unreadable:${String(error?.message || error)}`);
}

for (const name of filenames) {
  const filename = path.join(inputDir, name);
  try {
    const payload = JSON.parse(await fs.readFile(filename, "utf8"));
    payloads.push({ filename, payload });
  } catch (error) {
    structuralFailures.add(`invalid_artifact:${name}:${String(error?.message || error)}`);
  }
}

for (const market of markets) {
  const row = report.byMarket?.[market];
  const marketPayloads = payloads.filter(({ payload }) => payload?.market === market);
  if (!row) {
    structuralFailures.add(`${market}:missing_report_row`);
    continue;
  }
  if (Number(row.artifacts || 0) < expectedArtifactsPerMarket || marketPayloads.length < expectedArtifactsPerMarket) {
    structuralFailures.add(`${market}:artifacts_${Math.min(Number(row.artifacts || 0), marketPayloads.length)}_below_${expectedArtifactsPerMarket}`);
  }
  if (Array.isArray(row.processFailures) && row.processFailures.length) {
    structuralFailures.add(`${market}:process_failures:${row.processFailures.length}`);
  }
  for (const { filename, payload } of marketPayloads) {
    if (!Array.isArray(payload?.offers)) structuralFailures.add(`${market}:offers_missing:${path.basename(filename)}`);
    if (payload?.partial === true) structuralFailures.add(`${market}:partial_artifact:${path.basename(filename)}`);
    const stopReason = String(payload?.stopReason || payload?.report?.stopReason || "");
    if (["rebuild_process_failed", "collection_not_completed"].includes(stopReason)) {
      structuralFailures.add(`${market}:${stopReason}:${path.basename(filename)}`);
    }
  }
}

const structuralFailureList = [...structuralFailures];
const structuralOk = structuralFailureList.length === 0;
const integrityOk = markets.every((market) => {
  const row = report.byMarket?.[market];
  return row && Array.isArray(row.invalidOffers) && row.invalidOffers.length === 0;
});
const volumeTargetReached = markets.every((market) => report.byMarket?.[market]?.marketTargetReached === true);
const ok = structuralOk && integrityOk && (!requireVolume || volumeTargetReached);

Object.assign(report, {
  structuralOk,
  structuralFailures: structuralFailureList,
  integrityOk,
  volumeTargetReached,
  ok,
});

await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  reportFile,
  inputDir,
  markets,
  expectedArtifactsPerMarket,
  structuralOk,
  structuralFailures: structuralFailureList,
  integrityOk,
  volumeTargetReached,
  requireVolume,
  ok,
}, null, 2));

if ((failOnStructural && !structuralOk) || (failOnNotOk && !ok)) {
  process.exitCode = 1;
}
