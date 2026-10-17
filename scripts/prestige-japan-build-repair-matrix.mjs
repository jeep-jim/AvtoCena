import fs from "node:fs/promises";
import path from "node:path";

const inputDir = process.env.PRESTIGE_REPAIR_SOURCE_DIR || "prestige-source-chunks";
const output = process.env.PRESTIGE_REPAIR_MATRIX_OUTPUT || "prestige-japan-repair-matrix.json";

async function walk(dir) {
  const result = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await walk(full));
    else if (entry.isFile() && entry.name.endsWith(".json")) result.push(full);
  }
  return result;
}

function parseCursor(value) {
  const match = String(value || "").match(/^(\d+):(\d+):(\d+)$/);
  return match ? { makeIndex: Number(match[1]), modelIndex: Number(match[2]), offset: Number(match[3]) } : null;
}

const files = await walk(inputDir);
const reports = [];
for (const file of files) {
  try {
    const data = JSON.parse(await fs.readFile(file, "utf8"));
    const report = data?.report || {};
    if (report.mode === "prestige_exact_sold_source_only_chunk_no_publish" && !String(report.id || "").startsWith("repair-")) reports.push(report);
  } catch {}
}

reports.sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
const include = [];
const unrepairable = [];
let alreadyPassed = 0;
let partialAccepted = 0;

for (const report of reports) {
  partialAccepted += Number(report.accepted || 0);
  if (report.passed === true) {
    alreadyPassed++;
    continue;
  }
  const cursor = parseCursor(report.nextCursor || report.startCursor);
  const endOffset = Number(report.endOffset || 0);
  if (!cursor || !Number.isInteger(endOffset) || endOffset <= cursor.offset || cursor.makeIndex !== Number(report.expectedMakeIndex) || cursor.modelIndex !== Number(report.expectedModelIndex)) {
    unrepairable.push({ id: report.id || "unknown", nextCursor: report.nextCursor || "", endOffset, fatalError: report.fatalError || "" });
    continue;
  }
  const remainingRows = endOffset - cursor.offset;
  include.push({
    skip: false,
    repairOf: String(report.id),
    startCursor: `${cursor.makeIndex}:${cursor.modelIndex}:${cursor.offset}`,
    makeIndex: cursor.makeIndex,
    modelIndex: cursor.modelIndex,
    endOffset,
    maxPages: Math.max(1, Math.min(120, Math.ceil(remainingRows / 20))),
    remainingRows,
  });
}

const matrix = include.length ? { include } : { include: [{ skip: true, repairOf: "none", startCursor: "0:0:0", makeIndex: 0, modelIndex: 0, endOffset: 1, maxPages: 1, remainingRows: 0 }] };
const report = {
  version: 1,
  mode: "prestige_failed_chunk_repair_plan",
  sourceChunks: reports.length,
  alreadyPassed,
  repairCount: include.length,
  unrepairableCount: unrepairable.length,
  partialAccepted,
  unrepairable,
  matrix,
};
await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (process.env.GITHUB_OUTPUT) {
  await fs.appendFile(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\nrepair_count=${include.length}\nsource_chunk_count=${reports.length}\nunrepairable_count=${unrepairable.length}\n`);
}
if (unrepairable.length) process.exitCode = 1;
