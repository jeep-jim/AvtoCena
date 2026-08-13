const HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  origin: "https://m.encar.com",
  referer: "https://m.encar.com/",
  "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
};

const url = new URL("https://api.encar.com/search/car/list/mobile");
url.searchParams.set("count", "true");
url.searchParams.set("q", "(And.Hidden.N._.CarType.A.)");
url.searchParams.set("sr", "|MobileModifiedDate|0|50");
url.searchParams.set("inav", "|Metadata|Sort");

const response = await fetch(url, { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(30_000) });
const text = await response.text();
if (!response.ok) throw new Error(`encar_http_${response.status}`);
const json = JSON.parse(text);
const items = json.SearchResults || json.searchResults || json.cars || json.items || [];

const matches: { path: string; key: string; value: string }[] = [];
const wanted = /(?:manufacturer|maker|model|formyear|year|metadata|casper|캐스퍼|현대)/i;
function visit(value: any, path = "$", depth = 0) {
  if (value == null || depth > 8 || matches.length >= 250) return;
  if (Array.isArray(value)) {
    for (let index = 0; index < Math.min(value.length, 80); index++) visit(value[index], `${path}[${index}]`, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const scalar = child == null || typeof child === "object" ? "" : String(child);
    if (wanted.test(key) || wanted.test(scalar)) matches.push({ path: `${path}.${key}`, key, value: scalar.slice(0, 300) });
    if (typeof child === "object") visit(child, `${path}.${key}`, depth + 1);
    if (matches.length >= 250) return;
  }
}
visit(json);

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  httpStatus: response.status,
  bytes: Buffer.byteLength(text),
  topLevelKeys: Object.keys(json),
  count: Number(json.Count || json.count || 0),
  firstRows: items.slice(0, 8).map((row: any) => ({
    id: row.Id || row.CarId || row.carId,
    manufacturer: row.Manufacturer || row.ManufacturerName || row.maker,
    model: row.Model || row.ModelName,
    formYear: row.FormYear || row.Year || row.YearMonth,
    modifiedDate: row.ModifiedDate || row.UpdatedDate,
  })),
  metadataMatches: matches,
}, null, 2));
