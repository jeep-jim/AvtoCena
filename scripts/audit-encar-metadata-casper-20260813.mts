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
function keywordObjects(root: any, pattern: RegExp) {
  const rows: any[] = [];
  const seen = new Set<any>();
  function visit(value: any, path = "$", depth = 0) {
    if (value == null || depth > 12 || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (!Array.isArray(value)) {
      const direct: any = scalars(value);
      if (Object.entries(direct).some(([key, child]) => pattern.test(key) || pattern.test(String(child ?? "")))) rows.push({ path, ...direct });
    }
    if (Array.isArray(value)) value.slice(0, 3000).forEach((child, index) => visit(child, `${path}[${index}]`, depth + 1));
    else for (const [key, child] of Object.entries(value)) if (child && typeof child === "object") visit(child, `${path}.${key}`, depth + 1);
  }
  visit(root);
  return rows.slice(0, 250);
}
function rowText(row: any) {
  return Object.entries(row).filter(([key]) => key !== "Action" && key !== "path").map(([, value]) => String(value ?? "")).join(" ");
}
function findAction(rows: any[], pattern: RegExp) { return rows.find((row) => pattern.test(rowText(row))) || null; }
function findExpression(rows: any[], expression: string) { return rows.find((row) => String(row?.Expression || "") === expression) || null; }
function summarizeAction(row: any) {
  if (!row) return null;
  return { path: row.path, Name: row.Name, Value: row.Value, Count: row.Count, Expression: row.Expression, Action: row.Action };
}
function firstRows(json: any) {
  const items = Array.isArray(json?.SearchResults) ? json.SearchResults : [];
  return items.slice(0, 10).map((row: any) => ({ id: row.Id, manufacturer: row.Manufacturer, modelGroup: row.ModelGroup, model: row.Model, formYear: row.FormYear, badge: row.Badge, modifiedDate: row.ModifiedDate }));
}
function nodeNames(json: any) {
  return (Array.isArray(json?.iNav?.Nodes) ? json.iNav.Nodes : []).map((node: any, index: number) => ({ index, Name: node?.Name, Value: node?.Value, Count: node?.Count, facetCount: Array.isArray(node?.Facets) ? node.Facets.length : 0 }));
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
if (!domestic) fail("domestic_filter_not_found", { hyundai: summarizeAction(hyundai) }, 3);

const domesticResult = await request(domestic.Action);
const domesticActions = actionObjects(domesticResult.json);
const casper = findAction(domesticActions, /(?:캐스퍼|casper)/i);
if (!casper) fail("casper_not_found", { hyundai: summarizeAction(hyundai), domestic: summarizeAction(domestic) }, 4);

const probeInavs = [
  "|FormYear|Metadata|Sort",
  "|Year|Metadata|Sort",
  "|YearMonth|Metadata|Sort",
  "|RegistrationYear|Metadata|Sort",
  "|FirstRegistration|Metadata|Sort",
  "|Manufacturer|ModelGroup|Model|FormYear|Year|YearMonth|RegistrationYear|Metadata|Sort",
];
const yearNavigationProbes: any[] = [];
for (const inav of probeInavs) {
  const result = await request(casper.Action, inav);
  const actions = actionObjects(result.json);
  yearNavigationProbes.push({
    inav,
    count: Number(result.json?.Count || 0),
    nodes: nodeNames(result.json),
    yearActions: actions.filter((row) => /year|연식|등록/i.test(`${row?.Expression || ""} ${row?.path || ""} ${rowText(row)}`)).slice(0, 100).map(summarizeAction),
    yearMetadata: keywordObjects(result.json?.iNav || {}, /FormYear|YearMonth|RegistrationYear|FirstRegistration|연식|등록/i).slice(0, 100),
  });
}

const casperResult = await request(casper.Action, FULL_INAV);
const observedYears = new Map<number, number>();
// Page through only list metadata (no detail/photos/storage) to see how quickly
// the newest-modified stream reaches each model year. This is diagnostic only.
for (let offset = 0; offset < 1000; offset += 100) {
  const url = new URL("https://api.encar.com/search/car/list/mobile");
  url.searchParams.set("count", "true");
  url.searchParams.set("q", casper.Action);
  url.searchParams.set("sr", `|MobileModifiedDate|${offset}|100`);
  url.searchParams.set("inav", "|Metadata|Sort");
  const response = await fetch(url, { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(30_000) });
  const text = await response.text();
  if (!response.ok) break;
  const json = JSON.parse(text);
  const rows = Array.isArray(json?.SearchResults) ? json.SearchResults : [];
  for (const row of rows) {
    const raw = Number(row?.FormYear || 0);
    const year = raw >= 190000 ? Math.floor(raw / 100) : raw;
    if (year >= 2000 && year <= new Date().getFullYear() + 1) observedYears.set(year, Number(observedYears.get(year) || 0) + 1);
  }
  if (rows.length < 100) break;
}

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  baseCount: Number(base.json?.Count || 0),
  hyundai: summarizeAction(hyundai),
  hyundaiCount: Number(hyundaiResult.json?.Count || 0),
  domestic: summarizeAction(domestic),
  domesticCount: Number(domesticResult.json?.Count || 0),
  casper: summarizeAction(casper),
  casperCount: Number(casperResult.json?.Count || 0),
  casperFirstRows: firstRows(casperResult.json),
  observedFirst1000ByYear: Object.fromEntries([...observedYears.entries()].sort((a, b) => a[0] - b[0])),
  yearNavigationProbes,
}, null, 2));
