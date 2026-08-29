import fs from "node:fs/promises";
import path from "node:path";

const inputDir = process.env.JAPAN_EXACT_MERGE_INPUT_DIR || "japan-exact-chunks";
const output = process.env.JAPAN_EXACT_MERGE_OUTPUT || "japan-carvector-jpauc-exact.json";
const expectedScopes = String(process.env.JAPAN_EXACT_EXPECTED_SCOPES || process.env.JAPAN_EXACT_EXPECTED_MONTHS || "").split(",").map((value) => value.trim()).filter(Boolean);
const minimumChunkCoverage = Math.max(0, Math.min(1, Number(process.env.JAPAN_EXACT_MIN_CHUNK_COVERAGE || 1)));

const files = (await fs.readdir(inputDir)).filter((name) => name.endsWith(".json")).sort();
const payloads = [];
const errors = [];
for (const name of files) {
  try {
    const payload = JSON.parse(await fs.readFile(path.join(inputDir, name), "utf8"));
    if (!Array.isArray(payload?.offers) || !payload?.report?.month) throw new Error("chunk_shape_invalid");
    payloads.push({ name, payload });
  } catch (error) { errors.push({ name, error: String(error?.message || error) }); }
}
const receivedScopes = [...new Set(payloads.map(({ payload }) => String(payload.report.exactDate || payload.report.month)))].sort();
const missingScopes = expectedScopes.filter((scope) => !receivedScopes.includes(scope));
const coverage = expectedScopes.length ? receivedScopes.filter((scope) => expectedScopes.includes(scope)).length / expectedScopes.length : 0;
if (!payloads.length || coverage < minimumChunkCoverage) {
  throw new Error(`japan_exact_chunk_coverage_failed coverage=${coverage.toFixed(3)} received=${receivedScopes.join(",")} missing=${missingScopes.join(",")}`);
}

const offers = [...new Map(payloads.flatMap(({ payload }) => payload.offers).map((offer) => [String(offer?.id || ""), offer]).filter(([id]) => id)).values()];
const report = {
  version: 1, mode: "jpauc_carvector_exact_scope_merge", expectedScopes, receivedScopes, missingScopes, coverage,
  chunkCount: payloads.length, inputCount: payloads.reduce((sum, { payload }) => sum + Number(payload?.report?.exactJoined || 0), 0),
  count: offers.length, errors, chunkReports: payloads.map(({ name, payload }) => ({ name, ...payload.report, scans: undefined })),
};
await fs.writeFile(output, JSON.stringify({ offers, report }, null, 2));
console.log(JSON.stringify({ ...report, chunkReports: report.chunkReports.map((row) => ({ scope: row.exactDate || row.month, exactJoined: row.exactJoined, failureCount: row.failureCount })), output }, null, 2));
if (!offers.length) process.exitCode = 1;
