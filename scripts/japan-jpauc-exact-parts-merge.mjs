import fs from "node:fs/promises";
import path from "node:path";

const inputDir = process.env.JAPAN_EXACT_MERGE_INPUT_DIR || "japan-exact-parts";
const output = process.env.JAPAN_EXACT_MERGE_OUTPUT || "japan-carvector-jpauc-exact.json";
const expectedParts = String(process.env.JAPAN_EXACT_EXPECTED_PARTS || "0,1,2,3").split(",").map((value) => Number(value.trim())).filter(Number.isFinite);

const files = (await fs.readdir(inputDir)).filter((name) => name.endsWith(".json")).sort();
const payloads = [];
const errors = [];
for (const name of files) {
  try {
    const payload = JSON.parse(await fs.readFile(path.join(inputDir, name), "utf8"));
    if (!Array.isArray(payload?.offers) || !Number.isFinite(Number(payload?.report?.groupPartIndex))) throw new Error("exact_part_shape_invalid");
    payloads.push({ name, payload });
  } catch (error) {
    errors.push({ name, error: String(error?.message || error) });
  }
}
const receivedParts = [...new Set(payloads.map(({ payload }) => Number(payload.report.groupPartIndex)))].sort((a, b) => a - b);
const missingParts = expectedParts.filter((part) => !receivedParts.includes(part));
if (!payloads.length || missingParts.length) throw new Error(`japan_exact_part_coverage_failed received=${receivedParts.join(",")} missing=${missingParts.join(",")}`);

const offers = [...new Map(payloads.flatMap(({ payload }) => payload.offers)
  .map((offer) => [String(offer?.id || ""), offer]).filter(([id]) => id)).values()];
const report = {
  version: 1,
  mode: "jpauc_exact_partition_merge",
  expectedParts,
  receivedParts,
  missingParts,
  partCount: payloads.length,
  exactJoined: offers.length,
  carvectorEligible: Math.max(...payloads.map(({ payload }) => Number(payload?.report?.carvectorEligible || 0))),
  jpaucRowsScanned: payloads.reduce((sum, { payload }) => sum + Number(payload?.report?.jpaucRowsScanned || 0), 0),
  scanCount: payloads.reduce((sum, { payload }) => sum + Number(payload?.report?.scanCount || 0), 0),
  failures: payloads.flatMap(({ payload }) => payload?.report?.failures || []),
  errors,
  partReports: payloads.map(({ name, payload }) => ({ name, ...payload.report })),
};
await fs.writeFile(output, JSON.stringify({ offers, report }, null, 2));
console.log(JSON.stringify({ ...report, partReports: report.partReports.map((row) => ({ groupPartIndex: row.groupPartIndex, exactJoined: row.exactJoined })) , output }, null, 2));
if (!offers.length) process.exitCode = 1;
