const BASE_URL = "https://www.chngoodcar.com";
const LIST_URL = `${BASE_URL}/Home/CarsList`;
const SEARCH_URL = `${BASE_URL}/Car/SearchCarList`;
const PAGE_SIZE = 15;
const USER_AGENT = "AvtoCenaGoodCarCarsList/1.1 (+read-only until source promotion)";
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
  rawRowCount: number;
  rawNumericIds: string[];
  rejectedIdentityRowCount: number;
  rejectedIdentityReasons: Record<string, number>;
  rejectedIdentityIds: string[];
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

function rawRowId(raw: unknown) {
  const row = raw as Record<string, unknown> | null;
  if (!row || typeof row !== "object") return "";
  const id = clean(row.Id, 40);
  return /^\d+$/.test(id) ? id : "";
}

export function goodCarCarsListIdentityRejectionReason(raw: unknown) {
  const row = raw as Record<string, unknown> | null;
  if (!row || typeof row !== "object") return "invalid_row";
  const sourceOfferId = clean(row.Id, 40);
  if (!/^\d+$/.test(sourceOfferId)) return "invalid_id";
  if (!clean(row.Brand, 400)) return "missing_title";
  if (!positiveNumber(row.Price)) return "invalid_price";
  if (clean(row.Currency, 20).toUpperCase() !== "USD") return "non_usd_currency";
  if (!productionDate(row.ProductionDate)) return "invalid_production_date";
  if (nonNegativeNumber(row.Mileage) === undefined) return "invalid_mileage";
  return null;
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
  if (goodCarCarsListIdentityRejectionReason(raw)) return null;
  const row = raw as Record<string, unknown>;
  const sourceOfferId = clean(row.Id, 40);
  const sourceTitle = clean(row.Brand, 400);
  const listPrice = positiveNumber(row.Price)!;
  const listProductionDate = productionDate(row.ProductionDate)!;
  const listMileageKm = nonNegativeNumber(row.Mileage)!;
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
    const rawRows = payload.rows as unknown[];
    const rawNumericIds = rawRows.map(rawRowId).filter(Boolean);
    const rejectedIdentityReasons: Record<string, number> = {};
    const rejectedIdentityIds: string[] = [];
    const items: GoodCarCarsListIdentityRow[] = [];
    for (const raw of rawRows) {
      const reason = goodCarCarsListIdentityRejectionReason(raw);
      if (reason) {
        rejectedIdentityReasons[reason] = (rejectedIdentityReasons[reason] || 0) + 1;
        const id = rawRowId(raw);
        if (id) rejectedIdentityIds.push(id);
        continue;
      }
      const parsed = parseGoodCarCarsListIdentityRow(raw);
      if (parsed) items.push(parsed);
    }
    return {
      page,
      pageSize: PAGE_SIZE,
      total,
      currencyLabelVerified: session.currencyLabelVerified,
      rawRowCount: rawRows.length,
      rawNumericIds,
      rejectedIdentityRowCount: rawRows.length - items.length,
      rejectedIdentityReasons,
      rejectedIdentityIds,
      items,
    };
  }
}

export const GOOD_CAR_CARSLIST_PAGE_SIZE = PAGE_SIZE;
