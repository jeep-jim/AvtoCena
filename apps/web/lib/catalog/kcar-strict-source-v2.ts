import crypto from "node:crypto";
import { KCarStrictAdapter } from "./kcar-strict-source";
import type { CatalogFetchResult } from "./types";

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

function clean(value: unknown) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function positiveInt(value: unknown) {
  const n = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}
function sleep(ms: number) { return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve(); }
function encryptedBody(value: Record<string, unknown>) {
  const filtered = Object.fromEntries(Object.entries(value).filter(([, item]) => Boolean(item)));
  const cipher = crypto.createCipheriv("aes-128-cbc", KEY, IV);
  const enc = Buffer.concat([cipher.update(JSON.stringify(filtered), "utf8"), cipher.final()]).toString("base64");
  return JSON.stringify({ enc });
}
function retryDelay(response: Response, fallback: number) {
  const raw = clean(response.headers.get("retry-after"));
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(60_000, Math.round(seconds * 1000));
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.min(60_000, Math.max(0, date - Date.now())) : fallback;
}
async function requestJson(url: string, init: RequestInit = {}) {
  const attempts = Math.max(1, Math.min(6, Number(process.env.CATALOG_SOURCE_RETRY_ATTEMPTS || 5)));
  let last: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 35_000));
    try {
      const response = await fetch(url, {
        ...init,
        headers: { ...HEADERS, ...(init.headers || {}) },
        redirect: "follow",
        signal: controller.signal,
      });
      const text = await response.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch {}
      const retryable = [403, 429, 500, 502, 503, 504].includes(response.status);
      if (retryable && attempt < attempts - 1) {
        await sleep(retryDelay(response, Math.min(30_000, 1500 * 2 ** attempt)));
        continue;
      }
      return { response, json };
    } catch (error) {
      last = error;
      if (attempt === attempts - 1) throw error;
      await sleep(Math.min(30_000, 1500 * 2 ** attempt));
    } finally { clearTimeout(timer); }
  }
  throw last instanceof Error ? last : new Error("kcar_request_failed");
}
function detailUrl(carCd: string) { return `${WEB_BASE}/bc/detail/carInfoDtl?i_sCarCd=${encodeURIComponent(carCd)}`; }
function exactGallery(vrVo: any, carCd: string) {
  const numericId = carCd.replace(/^[^0-9]+/, "");
  if (!numericId) return [];
  const matcher = new RegExp(`^https://img\\.kcar\\.com/3dcarpicture/\\d{4}/\\d{2}/\\d+/${numericId}_[0-9]+/extra/extra_[0-9]+_hq\\.jpg(?:[?#].*)?$`, "i");
  const urls = clean(vrVo?.v_src_show)
    .split(",")
    .map((item) => item.trim().replace(/^['"]+|['"]+$/g, "").trim())
    .filter((url) => matcher.test(url));
  return [...new Set(urls)].slice(0, 30);
}
function exactRow(meta: any, data: any) {
  const rvo = data?.rvo || {};
  const id = clean(rvo.carCd);
  if (!id || id !== clean(meta?.carCd) || clean(rvo.statCd) !== "CAR_STATUS010") return null;
  const make = clean(rvo.mnuftrNm);
  const model = clean(rvo.modelNm);
  const trim = clean(rvo.grdFullNm || [rvo.grdNm, rvo.grdDtlNm].filter(Boolean).join(" "));
  const year = Number(rvo.regModelyr || String(rvo.mfgDt || "").slice(0, 4) || 0);
  const mileageKm = positiveInt(rvo.milg);
  const engineCc = positiveInt(rvo.engdispmnt);
  const hrspow = positiveInt(rvo.hrspow);
  const fuel = clean(rvo.fuelTypecdNm);
  const rawFuelType = clean(rvo.fuelType);
  const transmission = clean(rvo.trnsmsncdNm);
  const drive = clean(rvo.drvgYnNm);
  const bodyType = clean(rvo.carctgr);
  const sourcePriceManwon = Number(rvo.salprc || 0);
  const sourcePrice = Number.isFinite(sourcePriceManwon) && sourcePriceManwon > 0 ? Math.round(sourcePriceManwon * 10_000) : 0;
  const images = exactGallery(data?.vrVo, id);
  if (!make || !model || !trim || !year || !fuel || !transmission || !drive || !bodyType || !sourcePrice || !hrspow || images.length < 5) return null;
  if (clean(meta?.mnuftrNm) && clean(meta.mnuftrNm) !== make) return null;
  if (clean(meta?.modelNm) && clean(meta.modelNm) !== model) return null;
  const listPrice = positiveInt(meta?.prc);
  if (listPrice && listPrice !== Math.round(sourcePriceManwon)) return null;
  const listMileage = positiveInt(meta?.milg);
  if (listMileage && mileageKm && listMileage !== mileageKm) return null;
  const electricUnit = rawFuelType === "009" || rawFuelType === "013";
  return {
    id,
    url: detailUrl(id),
    title: [make, model, trim].join(" "),
    make,
    model,
    trim,
    year,
    productionDate: clean(rvo.mfgDt) || undefined,
    mileageKm,
    engineCc,
    ...(electricUnit ? { powerKw: hrspow } : { powerHp: hrspow }),
    fuel,
    transmission,
    drive,
    bodyType,
    color: clean(rvo.extrColorNm) || undefined,
    vin: clean(rvo.vin) || undefined,
    sourcePrice,
    sourceCurrency: "KRW" as const,
    images,
    rawFuelType,
    rawStatus: clean(rvo.statCdNm || rvo.statCd),
  };
}

export class KCarStrictAdapterV2 extends KCarStrictAdapter {
  override async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    if (page > 1) await sleep(Math.max(0, Math.min(10_000, Number(process.env.CATALOG_SOURCE_PAGE_DELAY_MS || 0))));
    const list = await requestJson(`${API_BASE}/bc/search/list/drct`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: encryptedBody({
        wr_in_multi_columns: "cntr_rgn_cd|cntr_cd",
        pageno: page,
        limit: 20,
        orderFlag: true,
        orderBy: "time_deal_yn:desc|time_deal_end_dt:asc|promo_ordr:asc|event_ordr:asc|sort_ordr:asc",
      }),
    });
    if (!list.response.ok || list.json?.success !== true) throw new Error(`kcar_strict_list_http_${list.response.status}_page_${page}`);
    const root = list.json?.data?.data ?? list.json?.data ?? {};
    const metas = Array.isArray(root?.rows) ? root.rows : [];
    const total = Number(root?.totalCnt || 0);
    const rows: any[] = [];
    const batchSize = Math.max(1, Math.min(4, Number(process.env.CATALOG_SOURCE_DETAIL_BATCH_SIZE || 2)));
    const batchDelay = Math.max(0, Math.min(5_000, Number(process.env.CATALOG_SOURCE_BATCH_DELAY_MS || 400)));
    for (let index = 0; index < metas.length; index += batchSize) {
      const batch = await Promise.all(metas.slice(index, index + batchSize).map(async (meta: any) => {
        const carCd = clean(meta?.carCd);
        if (!carCd) return null;
        const url = new URL(`${API_BASE}/bc/car-info-detail-of-ng`);
        url.searchParams.set("i_sCarCd", carCd);
        url.searchParams.set("i_sPassYn", "N");
        const detail = await requestJson(url.toString(), { headers: { referer: detailUrl(carCd) } }).catch(() => null);
        if (!detail?.response.ok || detail.json?.success !== true) return null;
        return exactRow(meta, detail.json?.data?.data ?? detail.json?.data ?? null);
      }));
      rows.push(...batch.filter(Boolean));
      if (index + batchSize < metas.length) await sleep(batchDelay);
    }
    const finished = metas.length === 0 || (total > 0 && page * 20 >= total);
    return {
      items: rows,
      nextCursor: finished ? null : String(page + 1),
      finished,
      count: rows.length,
      health: {
        ok: metas.length > 0,
        message: `K Car strict v2 page ${page}: ${rows.length}/${metas.length}; total=${total || "unknown"}`,
        checkedAt: new Date().toISOString(),
        httpStatus: list.response.status,
        contentType: list.response.headers.get("content-type") || "",
      },
    };
  }
}

export const kcarKoreaStrictSourceV2 = new KCarStrictAdapterV2();
