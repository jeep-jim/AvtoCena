import { readDataJson, writeDataJson } from "../data";

const RATE_CODES = ["USD", "EUR", "CNY", "JPY", "KRW", "AED"] as const;
type RateCode = (typeof RATE_CODES)[number];
type RateSource = "moex" | "cbr" | "legacy_json";

type StoredRate = {
  currency: RateCode;
  cbrRate: number;
  nominal: number;
  effectiveRate: number;
  rateDate: string;
  fetchedAt: string;
  rateSource: RateSource;
};

const MOEX_SECURITIES: Partial<Record<RateCode, string>> = {
  USD: "USD000UTSTOM",
  CNY: "CNYRUB_TOM",
  EUR: "EUR_RUB__TOM",
};

function validNumber(value: unknown) {
  const number = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function xmlText(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function fetchText(url: string, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json, application/xml, text/xml, */*",
        "user-agent": "AvtoCenaRates/1.0 (+https://avtocena.com)",
      },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`rates_http_${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseCbrXml(xml: string, fetchedAt: string): StoredRate[] {
  const rateDate = xml.match(/<ValCurs[^>]+Date="([^"]+)"/i)?.[1] || fetchedAt.slice(0, 10);
  const normalizedDate = /^\d{2}\.\d{2}\.\d{4}$/.test(rateDate)
    ? `${rateDate.slice(6, 10)}-${rateDate.slice(3, 5)}-${rateDate.slice(0, 2)}`
    : rateDate.slice(0, 10);
  const result: StoredRate[] = [];

  for (const block of xml.match(/<Valute\b[\s\S]*?<\/Valute>/gi) || []) {
    const code = xmlText(block.match(/<CharCode>([\s\S]*?)<\/CharCode>/i)?.[1] || "").trim().toUpperCase() as RateCode;
    if (!RATE_CODES.includes(code)) continue;
    const nominal = validNumber(block.match(/<Nominal>([\s\S]*?)<\/Nominal>/i)?.[1]) || 1;
    const cbrRate = validNumber(block.match(/<Value>([\s\S]*?)<\/Value>/i)?.[1]);
    if (!cbrRate) continue;
    result.push({
      currency: code,
      cbrRate,
      nominal,
      effectiveRate: cbrRate / nominal,
      rateDate: normalizedDate,
      fetchedAt,
      rateSource: "cbr",
    });
  }
  return result;
}

function tableRows(table: any) {
  if (!table || !Array.isArray(table.columns) || !Array.isArray(table.data)) return [] as Record<string, unknown>[];
  return table.data.map((row: unknown[]) => Object.fromEntries(table.columns.map((column: string, index: number) => [column, row[index]])));
}

async function fetchMoexRate(code: RateCode, fetchedAt: string): Promise<StoredRate | null> {
  const security = MOEX_SECURITIES[code];
  if (!security) return null;
  const url = new URL(`https://iss.moex.com/iss/engines/currency/markets/selt/securities/${security}.json`);
  url.searchParams.set("iss.meta", "off");
  url.searchParams.set("iss.only", "marketdata,securities");
  url.searchParams.set("marketdata.columns", "SECID,LAST,MARKETPRICE,WAPRICE,LCLOSEPRICE,UPDATETIME,SYSTIME");
  url.searchParams.set("securities.columns", "SECID,PREVPRICE,LOTSIZE");
  const json = JSON.parse(await fetchText(url.toString()));
  const row = [...tableRows(json.marketdata), ...tableRows(json.securities)]
    .find((item) => String(item.SECID || "") === security) || {};
  const value = validNumber(row.LAST) || validNumber(row.MARKETPRICE) || validNumber(row.WAPRICE) || validNumber(row.LCLOSEPRICE) || validNumber(row.PREVPRICE);
  if (!value) return null;
  return {
    currency: code,
    cbrRate: value,
    nominal: 1,
    effectiveRate: value,
    rateDate: fetchedAt.slice(0, 10),
    fetchedAt,
    rateSource: "moex",
  };
}

function legacyRate(code: RateCode, value: unknown, fetchedAt: string): StoredRate | null {
  const effectiveRate = validNumber(value);
  if (!effectiveRate) return null;
  return {
    currency: code,
    cbrRate: effectiveRate,
    nominal: 1,
    effectiveRate,
    rateDate: fetchedAt.slice(0, 10),
    fetchedAt,
    rateSource: "legacy_json",
  };
}

export async function refreshLiveExchangeRates() {
  const fetchedAt = new Date().toISOString();
  const previous = await readDataJson<any>("fees/exchange-rates.json", {});
  const rates = new Map<RateCode, StoredRate>();
  const errors: string[] = [];

  try {
    const cbrXml = await fetchText("https://www.cbr.ru/scripts/XML_daily.asp");
    for (const rate of parseCbrXml(cbrXml, fetchedAt)) rates.set(rate.currency, rate);
  } catch (error) {
    errors.push(`cbr:${(error as Error).message}`);
  }

  await Promise.all((["USD", "CNY", "EUR"] as RateCode[]).map(async (code) => {
    try {
      const rate = await fetchMoexRate(code, fetchedAt);
      if (rate) rates.set(code, rate);
    } catch (error) {
      errors.push(`moex_${code.toLowerCase()}:${(error as Error).message}`);
    }
  }));

  for (const code of RATE_CODES) {
    if (rates.has(code)) continue;
    const structured = Array.isArray(previous?.rates)
      ? previous.rates.find((item: any) => String(item?.currency || "").toUpperCase() === code)
      : null;
    const fallback = structured
      ? legacyRate(code, structured.effectiveRate || (Number(structured.cbrRate) / Number(structured.nominal || 1)), fetchedAt)
      : legacyRate(code, previous?.[`${code}_RUB`], fetchedAt);
    if (fallback) rates.set(code, fallback);
  }

  const list = RATE_CODES.map((code) => rates.get(code)).filter((rate): rate is StoredRate => Boolean(rate));
  const snapshot: any = {
    updatedAt: fetchedAt,
    rates: list,
    sources: {
      cbr: "https://www.cbr.ru/scripts/XML_daily.asp",
      moex: "https://iss.moex.com/iss/engines/currency/markets/selt/securities/{SECID}.json",
    },
    errors,
  };
  for (const rate of list) snapshot[`${rate.currency}_RUB`] = rate.effectiveRate;

  await writeDataJson("fees/exchange-rates.json", snapshot);
  return snapshot;
}
