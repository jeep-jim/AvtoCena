import fs from "node:fs/promises";

const ids = String(process.env.ENCAR_SHAPE_IDS || "42377300,42154170,42463510,42368907")
  .split(",").map((value) => value.trim()).filter(Boolean);
const output = process.env.ENCAR_SHAPE_OUTPUT || "encar-exact-detail-shape.json";
const headers = {
  accept: "application/json, text/plain, */*",
  "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  origin: "https://fem.encar.com",
  referer: "https://fem.encar.com/",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
};
const interestingKey = /power|horse|ps$|kw$|output|performance|drive|wheel|body|category|type|fuel|transmission|gear|engine|displacement|model|grade|form|spec|마력|출력|구동|차종|연료|변속|배기/i;
const interestingText = /\b(?:2wd|4wd|awd|fwd|rwd|suv|sedan|wagon|hatch|coupe|van|minivan|petrol|gasoline|diesel|hybrid|electric|automatic|manual)\b|마력|출력|구동|전륜|후륜|사륜|가솔린|디젤|하이브리드|전기|자동|수동/i;

function clean(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function walk(value, path = "$", rows = [], depth = 0) {
  if (depth > 15 || value == null) return rows;
  if (Array.isArray(value)) {
    value.forEach((child, index) => walk(child, `${path}[${index}]`, rows, depth + 1));
    return rows;
  }
  if (typeof value !== "object") return rows;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (child == null) continue;
    if (typeof child === "object") {
      walk(child, childPath, rows, depth + 1);
      continue;
    }
    const text = clean(child);
    if (!text) continue;
    if (interestingKey.test(key) || interestingText.test(text)) rows.push({ path: childPath, key, value: child });
  }
  return rows;
}

const reports = [];
for (const id of ids) {
  const response = await fetch(`https://api.encar.com/v1/readside/vehicle/${encodeURIComponent(id)}`, { headers });
  const body = response.ok ? await response.json() : null;
  const rows = body ? walk(body) : [];
  reports.push({
    id,
    status: response.status,
    topLevelKeys: body && typeof body === "object" ? Object.keys(body) : [],
    interesting: rows.slice(0, 1000),
  });
}
await fs.writeFile(output, JSON.stringify({ checkedAt: new Date().toISOString(), reports }, null, 2));
console.log(JSON.stringify({ reports: reports.map((row) => ({ id: row.id, status: row.status, matches: row.interesting.length })) }, null, 2));
