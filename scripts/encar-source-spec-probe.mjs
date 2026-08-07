import fs from "node:fs/promises";

const id = String(process.env.ENCAR_PROBE_ID || "42154170").trim();
const output = process.env.ENCAR_PROBE_OUTPUT || "encar-source-spec-probe.json";
const headers = {
  accept: "application/json, text/plain, text/html, */*",
  "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  origin: "https://fem.encar.com",
  referer: `https://fem.encar.com/cars/detail/${id}`,
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
};

function clean(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function matches(value, path = "$", out = [], depth = 0) {
  if (value == null || depth > 16) return out;
  if (Array.isArray(value)) {
    value.forEach((v, i) => matches(v, `${path}[${i}]`, out, depth + 1));
    return out;
  }
  if (typeof value !== "object") return out;
  for (const [key, child] of Object.entries(value)) {
    const p = `${path}.${key}`;
    if (child && typeof child === "object") { matches(child, p, out, depth + 1); continue; }
    const t = clean(child);
    if (!t) continue;
    if (/horse|power|ps$|kw$|output|drive|wheel|body|category|fuel|transmission|displacement|engine/i.test(key)
      || /마력|출력|2WD|4WD|AWD|FWD|RWD|SUV|세단|승용|가솔린|디젤|하이브리드|전기/i.test(t)) out.push({ path: p, key, value: child });
  }
  return out;
}
function htmlContexts(text) {
  const rows = [];
  const re = /horsePower|horsepower|powerHp|마력|출력|배기량/gi;
  let m;
  while ((m = re.exec(text)) && rows.length < 100) {
    rows.push({ token: m[0], context: text.slice(Math.max(0, m.index - 500), Math.min(text.length, m.index + 900)).replace(/\s+/g, " ") });
  }
  return rows;
}

const detailResponse = await fetch(`https://api.encar.com/v1/readside/vehicle/${encodeURIComponent(id)}`, { headers });
const detail = detailResponse.ok ? await detailResponse.json() : {};
const c = detail?.category || {};
const params = new URLSearchParams({ manufacturerCd: clean(c.manufacturerCd), modelCd: clean(c.modelCd) });
const jato = new URLSearchParams({
  manufacturerCd: clean(c.manufacturerCd),
  modelCd: clean(c.modelCd),
  badgeCd: clean(c.gradeCd),
  badgeDetailCd: clean(c.gradeDetailCd),
  yearMonth: clean(c.formYear),
});
const candidates = [
  `https://api.encar.com/v1/readside/vehicles?vehicleIds=${encodeURIComponent(id)}`,
  `https://api.encar.com/v1/readside/vehicles/view?vehicleIds=${encodeURIComponent(id)}`,
  `https://api.encar.com/v1/readside/vehicles/car/${encodeURIComponent(id)}`,
  `https://api.encar.com/v1/readside/vehicles/car/${encodeURIComponent(id)}/`,
  `https://api.encar.com/v1/readside/vehicle/category?${params}`,
  `https://api.encar.com/v1/readside/vehicle/category?include=PESTER&${params}`,
  `https://api.encar.com/usedcar/v1/vehicles/${encodeURIComponent(id)}?inflowType=WEB`,
  `https://api.encar.com/usedcar/v1/vehicles/${encodeURIComponent(id)}?inflowType=PC`,
  `https://api.encar.com/usedcar/v1/vehicles/${encodeURIComponent(id)}/specs/inspection-mileage`,
  `https://api.encar.com/usedcar/v1/options/jato?${jato}`,
  `https://api.encar.com/usedcar/v1/external-vehicles/detail?vehicleId=${encodeURIComponent(id)}`,
  `https://api.encar.com/usedcar/v1/external-vehicles/simple?vehicleId=${encodeURIComponent(id)}`,
  `https://api.encar.com/legacy/usedcar/sale/car/${encodeURIComponent(id)}`,
  `https://api.encar.com/legacy/usedcar/sale/car/${encodeURIComponent(id)}/simple`,
  `https://api.encar.com/legacy/usedcar/sale/car/simple?id=${encodeURIComponent(id)}`,
  `https://api.encar.com/legacy/usedcar/sale/car?carIds=${encodeURIComponent(id)}`,
  `https://fem.encar.com/cars/newcar/${encodeURIComponent(id)}`,
  `https://api.encar.com/v1/external-vehicles/detail?vehicleId=${encodeURIComponent(id)}`,
  `https://api.encar.com/v1/external-vehicles/simple?vehicleId=${encodeURIComponent(id)}`,
];

const reports = [];
for (const url of candidates) {
  try {
    const response = await fetch(url, { headers, redirect: "follow" });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    reports.push({
      url,
      resolvedUrl: response.url,
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      bytes: text.length,
      topLevelKeys: json && typeof json === "object" ? Object.keys(json) : [],
      matches: json ? matches(json).slice(0, 500) : [],
      htmlContexts: json ? [] : htmlContexts(text),
      textSample: json ? undefined : text.slice(0, 400),
    });
  } catch (error) {
    reports.push({ url, status: 0, error: String(error?.message || error), matches: [], htmlContexts: [] });
  }
}

const legacyUrls = [
  `https://www.encar.com/dc/dc_cardetailview.do?carid=${encodeURIComponent(id)}`,
];
const legacy = [];
for (const url of legacyUrls) {
  try {
    const response = await fetch(url, { headers, redirect: "follow" });
    const text = await response.text();
    legacy.push({
      url,
      resolvedUrl: response.url,
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      bytes: text.length,
      contexts: htmlContexts(text),
      textSample: text.slice(0, 500),
    });
  } catch (error) {
    legacy.push({ url, status: 0, error: String(error?.message || error), contexts: [] });
  }
}

const report = {
  checkedAt: new Date().toISOString(),
  id,
  category: {
    manufacturerCd: c.manufacturerCd,
    manufacturerName: c.manufacturerName,
    modelGroupCd: c.modelGroupCd,
    modelGroupName: c.modelGroupName,
    modelCd: c.modelCd,
    modelName: c.modelName,
    gradeCd: c.gradeCd,
    gradeName: c.gradeName,
    gradeDetailCd: c.gradeDetailCd,
    gradeDetailName: c.gradeDetailName,
    formYear: c.formYear,
  },
  reports,
  legacy,
};
await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  id,
  category: report.category,
  endpoints: reports.map((r) => ({ url: r.url, status: r.status, matches: r.matches.length, htmlMatches: r.htmlContexts.length })),
  legacy: legacy.map((r) => ({ url: r.url, resolvedUrl: r.resolvedUrl, status: r.status, contexts: r.contexts.length })),
}, null, 2));
