const HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  origin: "https://m.encar.com",
  referer: "https://m.encar.com/",
  "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
};

async function request(q: string, inav = "|Metadata|Sort") {
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

function interestingObjects(root: any) {
  const rows: any[] = [];
  const seen = new Set<any>();
  const wanted = /(?:^|\b)(?:manufacturer|maker|model|formyear|year|현대|hyundai|캐스퍼|casper)(?:\b|$)/i;
  function visit(value: any, path = "$", depth = 0) {
    if (value == null || depth > 10 || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (!Array.isArray(value)) {
      const direct = scalars(value);
      if (Object.entries(direct).some(([k, v]) => wanted.test(k) || wanted.test(String(v ?? "")))) {
        rows.push({ path, ...direct });
      }
    }
    if (Array.isArray(value)) value.slice(0, 500).forEach((child, index) => visit(child, `${path}[${index}]`, depth + 1));
    else for (const [key, child] of Object.entries(value)) if (child && typeof child === "object") visit(child, `${path}.${key}`, depth + 1);
  }
  visit(root);
  return rows.slice(0, 500);
}

function nodeSummary(json: any) {
  return (Array.isArray(json?.iNav?.Nodes) ? json.iNav.Nodes : []).map((node: any, index: number) => ({
    index,
    name: node?.Name,
    facetCount: Array.isArray(node?.Facets) ? node.Facets.length : 0,
    facets: (Array.isArray(node?.Facets) ? node.Facets : []).slice(0, 12).map((facet: any) => ({
      ...scalars(facet),
      refinements: Array.isArray(facet?.Refinements?.Nodes)
        ? facet.Refinements.Nodes.slice(0, 8).map((row: any) => scalars(row))
        : undefined,
    })),
  }));
}

const baseQ = "(And.Hidden.N._.CarType.A.)";
const base = await request(baseQ);
const items = base.json.SearchResults || [];
console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  httpStatus: base.status,
  bytes: base.bytes,
  count: Number(base.json.Count || 0),
  firstRows: items.slice(0, 8).map((row: any) => ({
    id: row.Id,
    manufacturer: row.Manufacturer,
    model: row.Model,
    formYear: row.FormYear,
    modifiedDate: row.ModifiedDate,
  })),
  nodes: nodeSummary(base.json),
  interesting: interestingObjects(base.json),
}, null, 2));
