import fs from "node:fs/promises";
import path from "node:path";

const inputDir = process.env.JAPAN_EVIDENCE_MERGE_INPUT_DIR || "japan-evidence-chunks";
const output = process.env.JAPAN_EVIDENCE_MERGE_OUTPUT || "japan-carvector-evidence.json";
const expectedScopes = String(process.env.JAPAN_EVIDENCE_EXPECTED_SCOPES || "").split(",").map((value) => value.trim()).filter(Boolean);

const files = (await fs.readdir(inputDir)).filter((name) => name.endsWith(".json")).sort();
const payloads = [];
const errors = [];
for (const name of files) {
  try {
    const payload = JSON.parse(await fs.readFile(path.join(inputDir, name), "utf8"));
    if (!Array.isArray(payload?.evidence) || !payload?.report?.scope) throw new Error("evidence_chunk_shape_invalid");
    payloads.push({ name, payload });
  } catch (error) {
    errors.push({ name, error: String(error?.message || error) });
  }
}

const receivedScopes = [...new Set(payloads.map(({ payload }) => String(payload.report.scope)))].sort();
const missingScopes = expectedScopes.filter((scope) => !receivedScopes.includes(scope));
if (!payloads.length || missingScopes.length) {
  throw new Error(`japan_evidence_chunk_coverage_failed received=${receivedScopes.join(",")} missing=${missingScopes.join(",")}`);
}

const evidence = [...new Map(payloads.flatMap(({ payload }) => payload.evidence)
  .map((row) => [String(row?.id || ""), row]).filter(([id]) => id)).values()];
const report = {
  version: 1,
  mode: "carvector_recent_evidence_merge",
  expectedScopes,
  receivedScopes,
  missingScopes,
  chunkCount: payloads.length,
  carvectorTotal: Math.max(...payloads.map(({ payload }) => Number(payload?.report?.carvectorTotal || 0))),
  carvectorEligible: evidence.length,
  errors,
  chunkReports: payloads.map(({ name, payload }) => ({ name, ...payload.report })),
};
await fs.writeFile(output, JSON.stringify({ evidence, report }, null, 2));
console.log(JSON.stringify({ ...report, chunkReports: report.chunkReports.map((row) => ({ scope: row.scope, carvectorEligible: row.carvectorEligible })), output }, null, 2));
if (!evidence.length) process.exitCode = 1;
