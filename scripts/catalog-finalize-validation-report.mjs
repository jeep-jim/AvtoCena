import fs from "node:fs/promises";

const reportFile = process.env.CATALOG_REBUILD_VALIDATION_REPORT || "catalog-source-scale-validation-report.json";
const markets = String(process.env.CATALOG_REBUILD_MARKETS || "korea,china,japan,uae,europe,georgia,kyrgyzstan")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const requireVolume = String(process.env.CATALOG_VALIDATION_REQUIRE_VOLUME || "false").toLowerCase() === "true";
const failOnStructural = String(process.env.CATALOG_VALIDATION_FAIL_ON_STRUCTURAL || "false").toLowerCase() === "true";
const failOnNotOk = String(process.env.CATALOG_VALIDATION_FAIL_ON_NOT_OK || "false").toLowerCase() === "true";

const report = JSON.parse(await fs.readFile(reportFile, "utf8"));
const structuralFailures = [];

if (Array.isArray(report.fileErrors) && report.fileErrors.length) {
  structuralFailures.push(`generation_file_errors:${report.fileErrors.length}`);
}

for (const market of markets) {
  const row = report.byMarket?.[market];
  if (!row) {
    structuralFailures.push(`${market}:missing_report_row`);
    continue;
  }
  if (!(Number(row.artifacts || 0) > 0)) structuralFailures.push(`${market}:missing_artifacts`);
  if (Array.isArray(row.processFailures) && row.processFailures.length) {
    structuralFailures.push(`${market}:process_failures:${row.processFailures.length}`);
  }
}

const structuralOk = structuralFailures.length === 0;
const integrityOk = markets.every((market) => {
  const row = report.byMarket?.[market];
  return row && Array.isArray(row.invalidOffers) && row.invalidOffers.length === 0;
});
const volumeTargetReached = markets.every((market) => report.byMarket?.[market]?.marketTargetReached === true);
const ok = structuralOk && integrityOk && (!requireVolume || volumeTargetReached);

Object.assign(report, {
  structuralOk,
  structuralFailures,
  integrityOk,
  volumeTargetReached,
  ok,
});

await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  reportFile,
  markets,
  structuralOk,
  structuralFailures,
  integrityOk,
  volumeTargetReached,
  requireVolume,
  ok,
}, null, 2));

if ((failOnStructural && !structuralOk) || (failOnNotOk && !ok)) {
  process.exitCode = 1;
}
