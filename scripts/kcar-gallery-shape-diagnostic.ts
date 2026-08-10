import crypto from "node:crypto";

const API_BASE = "https://api.kcar.com";
const WEB_BASE = "https://www.kcar.com";
const KEY = Buffer.from("SKFJ2424DasfaJRI", "utf8");
const IV = Buffer.from("sfq241sf3dscs321", "utf8");
const HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-language": "ko-KR,ko;q=0.9,en;q=0.7",
  origin: WEB_BASE,
  referer: `${WEB_BASE}/bc/search`,
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};

function encryptedBody(value: Record<string, unknown>) {
  const filtered = Object.fromEntries(Object.entries(value).filter(([, item]) => Boolean(item)));
  const cipher = crypto.createCipheriv("aes-128-cbc", KEY, IV);
  return JSON.stringify({ enc: Buffer.concat([cipher.update(JSON.stringify(filtered), "utf8"), cipher.final()]).toString("base64") });
}

async function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function jsonRequest(url: string, init: RequestInit = {}) {
  let last: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(url, { ...init, headers: { ...HEADERS, ...(init.headers || {}) }, redirect: "follow", signal: controller.signal });
      const text = await response.text();
      if (!response.ok) throw new Error(`http_${response.status}`);
      return JSON.parse(text);
    } catch (error) {
      last = error;
      console.warn(JSON.stringify({ event: "request_retry", attempt, url: new URL(url).pathname, error: String((error as Error)?.message || error) }));
      if (attempt < 4) await sleep(2500 * attempt);
    } finally { clearTimeout(timer); }
  }
  throw last;
}

type Hit = { path: string; url: string; exactCarId: boolean; extra: boolean };
function walkImages(value: unknown, numericId: string, path = "$", hits: Hit[] = [], depth = 0) {
  if (value == null || depth > 14 || hits.length >= 120) return hits;
  if (typeof value === "string") {
    const candidates = value.split(",").map((x) => x.trim().replace(/^[\'\"]+|[\'\"]+$/g, "").trim());
    for (const candidate of candidates) {
      if (!/^https?:\/\//i.test(candidate) || !/\.(?:jpe?g|png|webp)(?:[?#].*)?$/i.test(candidate)) continue;
      const exactCarId = new RegExp(`/${numericId}(?:_|/|-)`, "i").test(candidate);
      hits.push({ path, url: candidate, exactCarId, extra: /\/extra\//i.test(candidate) });
      if (hits.length >= 120) break;
    }
    return hits;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkImages(item, numericId, `${path}[${index}]`, hits, depth + 1));
    return hits;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) walkImages(child, numericId, `${path}.${key}`, hits, depth + 1);
  }
  return hits;
}

async function main() {
  const listing = await jsonRequest(`${API_BASE}/bc/search/list/drct`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: encryptedBody({
      wr_in_multi_columns: "cntr_rgn_cd|cntr_cd",
      pageno: 1,
      limit: 20,
      orderFlag: true,
      orderBy: "time_deal_yn:desc|time_deal_end_dt:asc|promo_ordr:asc|event_ordr:asc|sort_ordr:asc",
    }),
  });
  const root = listing?.data?.data ?? listing?.data ?? {};
  const rows: any[] = Array.isArray(root?.rows) ? root.rows : [];
  if (!rows.length) throw new Error("kcar_diag_no_listing_rows");
  const sample = rows.slice(0, 5);
  for (const row of sample) {
    const carCd = String(row?.carCd || "").trim();
    const numericId = carCd.replace(/^[^0-9]+/, "");
    if (!carCd || !numericId) continue;
    const detailUrl = new URL(`${API_BASE}/bc/car-info-detail-of-ng`);
    detailUrl.searchParams.set("i_sCarCd", carCd);
    detailUrl.searchParams.set("i_sPassYn", "N");
    const detail = await jsonRequest(detailUrl.toString(), { headers: { referer: `${WEB_BASE}/bc/detail/carInfoDtl?i_sCarCd=${encodeURIComponent(carCd)}` } });
    const data = detail?.data?.data ?? detail?.data ?? {};
    const hits = walkImages(data, numericId);
    const exact = hits.filter((hit) => hit.exactCarId);
    const grouped = Object.entries(exact.reduce((acc: Record<string, { count: number; extra: number; samples: string[] }>, hit) => {
      const key = hit.path.replace(/\[\d+\]/g, "[]");
      const entry = acc[key] ||= { count: 0, extra: 0, samples: [] };
      entry.count += 1;
      if (hit.extra) entry.extra += 1;
      if (entry.samples.length < 3) entry.samples.push(hit.url);
      return acc;
    }, {}));
    console.log(JSON.stringify({ carCd, model: row?.modelNm || null, totalImages: hits.length, exactImages: exact.length, groups: grouped }, null, 2));
    await sleep(900);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
