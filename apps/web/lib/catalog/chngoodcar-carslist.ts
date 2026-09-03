const BASE_URL = "https://www.chngoodcar.com";
const LIST_URL = `${BASE_URL}/Home/CarsList`;
const SEARCH_URL = `${BASE_URL}/Car/SearchCarList`;
const PAGE_SIZE = 15;
const USER_AGENT = "AvtoCenaGoodCarCarsList/1.0 (+read-only until source promotion)";
const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/json,text/javascript;q=0.9,*/*;q=0.5",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": USER_AGENT,
};

export type GoodCarCarsListIdentityRow = {
  sourceOfferId: string;
  detailUrl: string;
  sourceTitle: string;
  listPrice: number;
  listCurrency: "USD";
  listProductionDate: string;
  listMileageKm: number;
  listFuelName?: string;
  listVehicleTypeName?: string;
  listGearboxName?: string;
  listDrivingName?: string;
  listImageUrl?: string;
};

export type GoodCarCarsListPage = {
  page: number;
  pageSize: number;
  total: number;
  currencyLabelVerified: boolean;
  items: GoodCarCarsListIdentityRow[];
};

type GoodCarSession = {
  token: string;
  cookie: string;
  currencyLabelVerified: boolean;
  listStatus: number;
};

function clean(value: unknown, limit = 500) {
  return String(value ?? "").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function positiveNumber(value: unknown) {
  const n = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function nonNegativeNumber(value: unknown) {
  const n = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function productionDate(value: unknown) {
  const raw = clean(value, 20);
  const match = raw.match(/^((?:19|20)\d{2})-(0[1-9]|1[0-2])$/);
  return match ? `${match[1]}-${match[2]}` : undefined;
}

function extractVerificationToken(html: string) {
  for (const match of String(html || "").matchAll(/<input\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/\bname\s*=\s*["']__RequestVerificationToken["']/i.test(tag)) continue;
    return tag.match(/\bvalue\s*=\s*["']([^"']+)["']/i)?.[1] || "";
  }
  return "";
}

function cookieHeader(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const rows = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  const source = rows.length ? rows : (headers.get("set-cookie") ? [headers.get("set-cookie")!] : []);
  const pairs: string[] = [];
  for (const row of source) {
    const pair = String(row || "").split(";", 1)[0].trim();
    if (pair && pair.includes("=")) pairs.push(pair);
  }
  return [...new Set(pairs)].join("; ");
}

export function hasGoodCarCarsListUsdLabel(html: string) {
  const visible = String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  return /价格\s*\(\s*US\s*\$\s*\)/i.test(visible);
}

export function goodCarCarsListSearchBody(page: number) {
  const body = new URLSearchParams();
  body.set("Hot", "false");
  body.set("DefaultSort", "1");
  body.set("PriceSort", "0");
  body.set("MileageSort", "0");
  body.set("YearSort", "0");
  body.set("pageindex", String(page));
  body.set("pagesize", String(PAGE_SIZE));
  return body.toString();
}

export function parseGoodCarCarsListIdentityRow(raw: unknown): GoodCarCarsListIdentityRow | null {
  const row = raw as Record<string, unknown> | null;
  if (!row || typeof row !== "object") return null;
  const sourceOfferId = clean(row.Id, 40);
  if (!/^\d+$/.test(sourceOfferId)) return null;
  const sourceTitle = clean(row.Brand, 400);
  const listPrice = positiveNumber(row.Price);
  const currencyRaw = clean(row.Currency, 20).toUpperCase();
  const listProductionDate = productionDate(row.ProductionDate);
  const listMileageKm = nonNegativeNumber(row.Mileage);
  if (!sourceTitle || !listPrice || currencyRaw !== "USD" || !listProductionDate || listMileageKm === undefined) return null;
  const listImageFile = clean(row.Url, 300);
  const listImageUrl = /^[a-zA-Z0-9._-]+\.(?:jpe?g|png|webp|avif)$/i.test(listImageFile)
    ? `https://image.cn.ucoc.net/Picture/Automobile/LargeThumbnail/${listImageFile}`
    : undefined;
  return {
    sourceOfferId,
    detailUrl: `${BASE_URL}/Home/Cars?id=${encodeURIComponent(sourceOfferId)}`,
    sourceTitle,
    listPrice,
    listCurrency: "USD",
    listProductionDate,
    listMileageKm,
    listFuelName: clean(row.FuelTypeName, 80) || undefined,
    listVehicleTypeName: clean(row.VehicleTypeName, 80) || undefined,
    listGearboxName: clean(row.GearboxName, 80) || undefined,
    listDrivingName: clean(row.DrivingName, 80) || undefined,
    listImageUrl,
  };
}

async function fetchText(url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { ...HEADERS, ...((init.headers || {}) as Record<string, string>) },
    redirect: "follow",
    signal: AbortSignal.timeout(Math.max(8_000, Number(process.env.CATALOG_SOURCE_REQUEST_TIMEOUT_MS || 30_000))),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`chngoodcar_carslist_http_${response.status}:${url}`);
  return { response, text };
}

export class GoodCarCarsListClient {
  private sessionPromise: Promise<GoodCarSession> | null = null;

  private async session() {
    if (!this.sessionPromise) this.sessionPromise = this.bootstrap();
    return this.sessionPromise;
  }

  private async bootstrap(): Promise<GoodCarSession> {
    const { response, text } = await fetchText(LIST_URL, { headers: { referer: BASE_URL } });
    const token = extractVerificationToken(text);
    const currencyLabelVerified = hasGoodCarCarsListUsdLabel(text);
    if (!token) throw new Error("chngoodcar_carslist_verification_token_missing");
    if (!currencyLabelVerified) throw new Error("chngoodcar_carslist_usd_label_missing");
    return {
      token,
      cookie: cookieHeader(response),
      currencyLabelVerified,
      listStatus: response.status,
    };
  }

  async fetchPage(pageValue: number): Promise<GoodCarCarsListPage> {
    const page = Math.max(1, Math.trunc(Number(pageValue) || 1));
    const session = await this.session();
    const body = goodCarCarsListSearchBody(page);
    const { response, text } = await fetchText(SEARCH_URL, {
      method: "POST",
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
        "__RequestVerificationToken": session.token,
        origin: BASE_URL,
        referer: LIST_URL,
        ...(session.cookie ? { cookie: session.cookie } : {}),
      },
      body,
    });
    let payload: any;
    try { payload = JSON.parse(text); } catch { throw new Error(`chngoodcar_carslist_non_json_${response.status}`); }
    const total = Number(payload?.total);
    if (!Number.isInteger(total) || total < 0 || !Array.isArray(payload?.rows)) throw new Error("chngoodcar_carslist_invalid_payload");
    const items = payload.rows.map(parseGoodCarCarsListIdentityRow).filter((row: GoodCarCarsListIdentityRow | null): row is GoodCarCarsListIdentityRow => Boolean(row));
    return {
      page,
      pageSize: PAGE_SIZE,
      total,
      currencyLabelVerified: session.currencyLabelVerified,
      items,
    };
  }
}

export const GOOD_CAR_CARSLIST_PAGE_SIZE = PAGE_SIZE;
