const HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  origin: "https://m.encar.com",
  referer: "https://m.encar.com/",
  "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
};

async function request(q: string, inav = "|Metadata|Sort", pageSize = 100) {
  const url = new URL("https://api.encar.com/search/car/list/mobile");
  url.searchParams.set("count", "true");
  url.searchParams.set("q", q);
  url.searchParams.set("sr", `|MobileModifiedDate|0|${pageSize}`);
  url.searchParams.set("inav", inav);
  const response = await fetch(url, { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(30_000) });
  const body = await response.text();
  if (!response.ok) throw new Error(`encar_http_${response.status}`);
  return { json: JSON.parse(body), url: url.toString(), status: response.status, bytes: Buffer.byteLength(body) };
}

function scalars(value: any) {
  return Object.fromEntries(Object.entries(value || {}).filter(([, v]) => v == null || ["string", "number", "boolean"].includes(typeof v)));
}
function actions(root: any) {
  const result: any[] = [];
  const seen = new Set<any>();
  function visit(value: any, path = "$", depth = 0) {
    if (value == null || depth > 12 || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (!Array.isArray(value)) {
      const direct: any = scalars(value);
      if (typeof direct.Action === "string" && direct.Action.includes("(And.")) result.push({ path, ...direct });
    }
    if (Array.isArray(value)) value.slice(0, 2500).forEach((child, i) => visit(child, `${path}[${i}]`, depth + 1));
    else for (const [key, child] of Object.entries(value)) if (child && typeof child === "object") visit(child, `${path}.${key}`, depth + 1);
  }
  visit(root);
  return result;
}
function findByValue(rows: any[], pattern: RegExp) {
  return rows.find((row) => pattern.test(String(row?.Value || row?.DisplayValue || ""))) || null;
}
function findExpr(rows: any[], expression: string) {
  return rows.find((row) => String(row?.Expression || "") === expression) || null;
}
function yearTemplate(json: any) {
  const node = (Array.isArray(json?.iNav?.Nodes) ? json.iNav.Nodes : []).find((row: any) => row?.Name === "Year");
  const template = String(node?.QueryWithPlaceholder || "");
  if (!template.includes("<!lower>") || !template.includes("<!upper>")) return null;
  return { template, type: node?.Type, displayName: node?.DisplayName, lower: node?.LowerPlaceholder, upper: node?.UpperPlaceholder };
}
function rows(json: any) {
  return Array.isArray(json?.SearchResults) ? json.SearchResults : [];
}
function normalizedYear(row: any) {
  const raw = Number(row?.FormYear || row?.Year || 0);
  return raw >= 190000 ? Math.floor(raw / 100) : raw;
}
function summarizeResult(label: string, lower: string, upper: string, result: any) {
  const list = rows(result.json);
  const byYear = new Map<number, number>();
  for (const row of list) {
    const year = normalizedYear(row);
    if (year) byYear.set(year, Number(byYear.get(year) || 0) + 1);
  }
  return {
    label,
    lower,
    upper,
    httpStatus: result.status,
    count: Number(result.json?.Count || 0),
    returned: list.length,
    returnedByYear: Object.fromEntries([...byYear.entries()].sort((a, b) => a[0] - b[0])),
    first: list.slice(0, 5).map((row: any) => ({ id: row.Id, formYear: row.FormYear, model: row.Model, badge: row.Badge })),
  };
}

const baseQ = "(And.Hidden.N._.CarType.A.)";
const base = await request(baseQ, "|Manufacturer|ModelGroup|Model|Year|Metadata|Sort", 20);
const hyundai = findByValue(actions(base.json), /^(?:현대|hyundai)$/i);
if (!hyundai) throw new Error("hyundai_action_missing");
const hyundaiResult = await request(hyundai.Action, "|Manufacturer|ModelGroup|Model|Year|Metadata|Sort", 20);
const domestic = findExpr(actions(hyundaiResult.json), "ModelCarType.A.");
if (!domestic) throw new Error("domestic_action_missing");
const domesticResult = await request(domestic.Action, "|Manufacturer|ModelGroup|Model|Year|Metadata|Sort", 20);
const casper = findByValue(actions(domesticResult.json), /^캐스퍼$/i);
if (!casper) throw new Error("casper_action_missing");
const casperMetadata = await request(casper.Action, "|Year|Metadata|Sort", 20);
const sourceYear = yearTemplate(casperMetadata.json);
if (!sourceYear) throw new Error("source_year_template_missing");

const candidates = [
  { label: "yyyy", lower: "2022", upper: "2022" },
  { label: "yyyymm_open", lower: "202200", upper: "202299" },
  { label: "yyyymm_months", lower: "202201", upper: "202212" },
  { label: "yyyymm_daylike", lower: "20220101", upper: "20221231" },
];
const probes: any[] = [];
for (const candidate of candidates) {
  const q = sourceYear.template
    .replace("<!lower>", candidate.lower)
    .replace("<!upper>", candidate.upper);
  try {
    const result = await request(q, "|Metadata|Sort", 100);
    probes.push(summarizeResult(candidate.label, candidate.lower, candidate.upper, result));
  } catch (error: any) {
    probes.push({ ...candidate, error: String(error?.message || error) });
  }
}

const exact2022 = probes.filter((probe) => !probe.error && Number(probe.count || 0) > 0 && Object.keys(probe.returnedByYear || {}).every((year) => year === "2022"));
console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  casperCount: Number(casperMetadata.json?.Count || 0),
  sourceYearTemplate: sourceYear,
  probes,
  exact2022Candidates: exact2022.map((probe) => probe.label),
}, null, 2));
if (!exact2022.length) process.exit(7);
