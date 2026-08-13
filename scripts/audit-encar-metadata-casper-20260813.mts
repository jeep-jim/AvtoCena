const HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  origin: "https://m.encar.com",
  referer: "https://m.encar.com/",
  "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
};
const q = "(And.Hidden.N._.CarType.A.)";
const pageSize = 100;
const maxRows = 10_000;
const byYear = new Map<number, number>();
const samples: any[] = [];
let seen = 0;
let total = 0;
let firstCasperOffset: number | null = null;

function yearOf(row: any) {
  const raw = Number(row?.FormYear || row?.Year || 0);
  return raw >= 190000 ? Math.floor(raw / 100) : raw;
}
function isCasper(row: any) {
  const manufacturer = String(row?.Manufacturer || row?.ManufacturerName || "").trim();
  const model = String(row?.Model || row?.ModelName || "").trim();
  return /^(?:현대|hyundai)$/i.test(manufacturer) && /^(?:캐스퍼|casper)$/i.test(model);
}

for (let offset = 0; offset < maxRows; offset += pageSize) {
  const url = new URL("https://api.encar.com/search/car/list/mobile");
  url.searchParams.set("count", "true");
  url.searchParams.set("q", q);
  url.searchParams.set("sr", `|MobileModifiedDate|${offset}|${pageSize}`);
  url.searchParams.set("inav", "|Metadata|Sort");
  const response = await fetch(url, { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(30_000) });
  const body = await response.text();
  if (!response.ok) throw new Error(`encar_http_${response.status}_offset_${offset}`);
  const json = JSON.parse(body);
  total = Number(json?.Count || total || 0);
  const rows = Array.isArray(json?.SearchResults) ? json.SearchResults : [];
  seen += rows.length;
  for (const row of rows) {
    if (!isCasper(row)) continue;
    if (firstCasperOffset == null) firstCasperOffset = offset;
    const year = yearOf(row);
    if (year) byYear.set(year, Number(byYear.get(year) || 0) + 1);
    if (samples.length < 25) samples.push({ id: row.Id, formYear: row.FormYear, badge: row.Badge, price: row.Price, modifiedDate: row.ModifiedDate });
  }
  if (rows.length < pageSize) break;
}

const result = {
  checkedAt: new Date().toISOString(),
  sourceCount: total,
  scannedRows: seen,
  firstCasperPageOffset: firstCasperOffset,
  casperTotalInScan: [...byYear.values()].reduce((a, b) => a + b, 0),
  casperByFormYear: Object.fromEntries([...byYear.entries()].sort((a, b) => a[0] - b[0])),
  casper2022InScan: Number(byYear.get(2022) || 0),
  samples,
};
console.log(JSON.stringify(result, null, 2));
if (!Number(byYear.get(2022) || 0)) process.exit(8);
