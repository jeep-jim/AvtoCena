const HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  origin: "https://m.encar.com",
  referer: "https://m.encar.com/",
  "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
};

const FULL_INAV = "|Manufacturer|ModelGroup|Model|FormYear|Metadata|Sort";

async function request(q: string, inav = FULL_INAV) {
  const url = new URL("https://api.encar.com/search/car/list/mobile");
  url.searchParams.set("count", "true");
  url.searchParams.set("q", q);
  url.searchParams.set("sr", "|MobileModifiedDate|0|20");
  url.searchParams.set("inav", inav);
  const response = await fetch(url, { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(30_000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`encar_http_${response.status}`);
  return { url: url.toString(), json: JSON.parse(text), bytes: Buffer.byteLength(text), status: response.status };
}

function scalars(value: any) {
  return Object.fromEntries(Object.entries(value || {}).filter(([, v]) => v == null || ["string", "number", "boolean"].includes(typeof v)));
}

function actionObjects(root: any) {
  const rows: any[] = [];
  const seen = new Set<any>();
  function visit(value: any, path = "$", depth = 0) {
    if (value == null || depth > 12 || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (!Array.isArray(value)) {
      const direct: any = scalars(value);
      if (typeof direct.Action === "string" && direct.Action.includes("(And.")) rows.push({ path, ...direct });
    }
    if (Array.isArray(value)) value.slice(0, 3000).forEach((child, index) => visit(child, `${path}[${index}]`, depth + 1));
    else for (const [key, child] of Object.entries(value)) if (child && typeof child === "object") visit(child, `${path}.${key}`, depth + 1);
  }
  visit(root);
  const dedup = new Map<string, any>();
  for (const row of rows) if (!dedup.has(row.Action)) dedup.set(row.Action, row);
  return [...dedup.values()];
}

function rowText(row: any) {
  return Object.entries(row)
    .filter(([key]) => key !== "Action" && key !== "path")
    .map(([, value]) => String(value ?? ""))
    .join(" ");
}
function findAction(rows: any[], pattern: RegExp) { return rows.find((row) => pattern.test(rowText(row))) || null; }
function findExpression(rows: any[], expression: string) { return rows.find((row) => String(row?.Expression || "") === expression) || null; }
function summarizeAction(row: any) {
  if (!row) return null;
  return { path: row.path, Name: row.Name, Value: row.Value, Count: row.Count, Expression: row.Expression, Action: row.Action };
}
function firstRows(json: any) {
  const items = Array.isArray(json?.SearchResults) ? json.SearchResults : [];
  return items.slice(0, 10).map((row: any) => ({
    id: row.Id,
    manufacturer: row.Manufacturer,
    modelGroup: row.ModelGroup,
    model: row.Model,
    formYear: row.FormYear,
    badge: row.Badge,
    modifiedDate: row.ModifiedDate,
  }));
}
function fail(stage: string, payload: any, code: number): never {
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), stage, ...payload }, null, 2));
  process.exit(code);
}

const baseQ = "(And.Hidden.N._.CarType.A.)";
const base = await request(baseQ);
const baseActions = actionObjects(base.json);
const hyundai = findAction(baseActions, /(?:^|\s)(?:현대|hyundai)(?:\s|$)/i);
if (!hyundai) fail("manufacturer_not_found", { baseCount: Number(base.json?.Count || 0) }, 2);

const hyundaiResult = await request(hyundai.Action);
const hyundaiActions = actionObjects(hyundaiResult.json);
const domestic = findExpression(hyundaiActions, "ModelCarType.A.");
if (!domestic) fail("domestic_filter_not_found", {
  hyundai: summarizeAction(hyundai),
  hyundaiCount: Number(hyundaiResult.json?.Count || 0),
  candidates: hyundaiActions.filter((row) => /ModelCarType/i.test(String(row?.Expression || ""))).map(summarizeAction),
}, 3);

const domesticResult = await request(domestic.Action);
const domesticActions = actionObjects(domesticResult.json);
let casper = findAction(domesticActions, /(?:캐스퍼|casper)/i);
let casperParent: any = null;

// Some Encar hierarchies expose a model group first and the exact model only
// after applying that source-provided action. Never manufacture the q syntax.
if (casper && /ModelGroup/i.test(String(casper?.Expression || casper?.path || "")) && !/^Model\./i.test(String(casper?.Expression || ""))) {
  casperParent = casper;
  const parentResult = await request(casperParent.Action);
  const parentActions = actionObjects(parentResult.json);
  const exact = findAction(parentActions, /(?:캐스퍼|casper)/i);
  if (exact) casper = exact;
}

if (!casper) fail("casper_not_found", {
  hyundai: summarizeAction(hyundai),
  domestic: summarizeAction(domestic),
  domesticCount: Number(domesticResult.json?.Count || 0),
  modelGroupCandidates: domesticActions
    .filter((row) => /ModelGroup|Model\./i.test(String(row?.Expression || row?.path || "")))
    .slice(0, 220)
    .map(summarizeAction),
}, 4);

const casperResult = await request(casper.Action);
const casperActions = actionObjects(casperResult.json);
const yearsByYear = new Map<number, any>();
for (const row of casperActions) {
  const scope = `${row?.Expression || ""} ${row?.path || ""}`;
  if (!/FormYear/i.test(scope)) continue;
  const match = rowText(row).match(/\b(20\d{2})\b/);
  if (!match) continue;
  const year = Number(match[1]);
  const existing = yearsByYear.get(year);
  if (!existing || Number(row?.Count || 0) > Number(existing?.Count || 0)) yearsByYear.set(year, row);
}
if (!yearsByYear.size) fail("formyear_not_found", {
  hyundai: summarizeAction(hyundai),
  domestic: summarizeAction(domestic),
  casperParent: summarizeAction(casperParent),
  casper: summarizeAction(casper),
  casperCount: Number(casperResult.json?.Count || 0),
  formYearCandidates: casperActions.filter((row) => /FormYear/i.test(String(row?.Expression || row?.path || ""))).slice(0, 100).map(summarizeAction),
}, 5);

const allowedYears = [...yearsByYear.keys()]
  .filter((year) => year >= 2020 && year <= new Date().getFullYear() + 1)
  .sort((a, b) => a - b);
const exactYearCounts: any[] = [];
for (const year of allowedYears) {
  const row = yearsByYear.get(year);
  const result = await request(row.Action, "|Metadata|Sort");
  exactYearCounts.push({
    year,
    sourceFacetCount: Number(row?.Count || 0),
    exactQueryCount: Number(result.json?.Count || 0),
    action: summarizeAction(row),
    firstRows: firstRows(result.json).slice(0, 3),
  });
}

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  baseCount: Number(base.json?.Count || 0),
  hyundai: summarizeAction(hyundai),
  hyundaiCount: Number(hyundaiResult.json?.Count || 0),
  domestic: summarizeAction(domestic),
  domesticCount: Number(domesticResult.json?.Count || 0),
  casperParent: summarizeAction(casperParent),
  casper: summarizeAction(casper),
  casperCount: Number(casperResult.json?.Count || 0),
  casperFirstRows: firstRows(casperResult.json),
  discoveredFormYears: [...yearsByYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, row]) => ({ year, ...summarizeAction(row) })),
  allowedExactYearCounts: exactYearCounts,
}, null, 2));
