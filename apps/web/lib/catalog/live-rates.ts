import { readDataJson, writeDataJson } from "../data";

const RATE_CODES = ["USD", "EUR", "CNY", "JPY", "KRW", "AED", "GBP", "PLN", "CHF", "SEK", "NOK", "DKK", "HUF", "CZK"] as const;
type RateCode = (typeof RATE_CODES)[number];
type RateSource = "moex" | "cbr" | "legacy_json";
type RateHistoryPoint = { date: string; effectiveRate: number };

type StoredRate = {
  currency: RateCode;
  cbrRate: number;
  nominal: number;
  effectiveRate: number;
  previousEffectiveRate?: number;
  previousRateDate?: string;
  rateDelta?: number;
  rateDate: string;
  fetchedAt: string;
  rateSource: RateSource;
  history?: RateHistoryPoint[];
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

function finiteNumber(value: unknown) {
  const number = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) ? number : undefined;
}

function xmlText(value: string) {
  return value.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

async function fetchText(url: string, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json, application/xml, text/xml, */*", "user-agent": "AvtoCenaRates/1.0 (+https://avtocena.com)" },
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
    result.push({ currency: code, cbrRate, nominal, effectiveRate: cbrRate / nominal, rateDate: normalizedDate, fetchedAt, rateSource: "cbr" });
  }
  return result;
}

function cbrRequestDate(date: Date) {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getUTCFullYear()}`;
}

async function fetchCbrSnapshots(currentRows: StoredRate[], fetchedAt: string, points = 5) {
  const snapshots = new Map<string, StoredRate[]>();
  const add = (rows: StoredRate[]) => {
    const date = rows[0]?.rateDate;
    if (date && !snapshots.has(date)) snapshots.set(date, rows);
  };
  add(currentRows);

  const cursor = new Date(`${currentRows[0]?.rateDate || fetchedAt.slice(0, 10)}T12:00:00Z`);
  for (let daysBack = 1; snapshots.size < points && daysBack <= 12; daysBack++) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    try {
      const url = new URL("https://www.cbr.ru/scripts/XML_daily.asp");
      url.searchParams.set("date_req", cbrRequestDate(cursor));
      add(parseCbrXml(await fetchText(url.toString()), fetchedAt));
    } catch {
      // Skip unavailable calendar days and keep walking backwards.
    }
  }

  return [...snapshots.values()]
    .sort((left, right) => String(left[0]?.rateDate || "").localeCompare(String(right[0]?.rateDate || "")))
    .slice(-points);
}

function attachPrevious(current: StoredRate, previous: StoredRate | undefined) {
  if (!previous?.effectiveRate || previous.effectiveRate <= 0) return current;
  current.previousEffectiveRate = previous.effectiveRate;
  current.previousRateDate = previous.rateDate;
  current.rateDelta = current.effectiveRate - previous.effectiveRate;
  return current;
}

function tableRows(table: any): Record<string, unknown>[] {
  if (!table || !Array.isArray(table.columns) || !Array.isArray(table.data)) return [];
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
  const marketRow = tableRows(json.marketdata).find((item) => String(item.SECID || "") === security) || {};
  const securityRow = tableRows(json.securities).find((item) => String(item.SECID || "") === security) || {};
  const value = validNumber(marketRow.LAST) || validNumber(marketRow.MARKETPRICE) || validNumber(marketRow.WAPRICE) || validNumber(marketRow.LCLOSEPRICE) || validNumber(securityRow.PREVPRICE);
  if (!value) return null;
  const previous = validNumber(securityRow.PREVPRICE) || validNumber(marketRow.LCLOSEPRICE);
  const result: StoredRate = { currency: code, cbrRate: value, nominal: 1, effectiveRate: value, rateDate: fetchedAt.slice(0, 10), fetchedAt, rateSource: "moex" };
  if (previous > 0 && Math.abs(value - previous) > 1e-9) {
    result.previousEffectiveRate = previous;
    result.previousRateDate = fetchedAt.slice(0, 10);
    result.rateDelta = value - previous;
  }
  return result;
}

function legacyRate(code: RateCode, value: unknown, fetchedAt: string): StoredRate | null {
  const effectiveRate = validNumber(value);
  if (!effectiveRate) return null;
  return { currency: code, cbrRate: effectiveRate, nominal: 1, effectiveRate, rateDate: fetchedAt.slice(0, 10), fetchedAt, rateSource: "legacy_json" };
}

function normalizeHistory(value: unknown) {
  if (!Array.isArray(value)) return [] as RateHistoryPoint[];
  const result = new Map<string, number>();
  for (const item of value) {
    const date = String(item?.date || item?.rateDate || "").slice(0, 10);
    const effectiveRate = validNumber(item?.effectiveRate ?? item?.value);
    if (date && effectiveRate) result.set(date, effectiveRate);
  }
  return [...result].map(([date, effectiveRate]) => ({ date, effectiveRate })).sort((a, b) => a.date.localeCompare(b.date)).slice(-5);
}

function previousRate(previous: any, code: RateCode) {
  const structured = Array.isArray(previous?.rates)
    ? previous.rates.find((item: any) => String(item?.currency || "").toUpperCase() === code)
    : null;
  const effectiveRate = validNumber(structured?.effectiveRate)
    || (validNumber(structured?.cbrRate) && validNumber(structured?.nominal) ? validNumber(structured.cbrRate) / validNumber(structured.nominal) : 0)
    || validNumber(previous?.[`${code}_RUB`]);
  return {
    effectiveRate,
    previousEffectiveRate: validNumber(structured?.previousEffectiveRate),
    rateDelta: finiteNumber(structured?.rateDelta),
    rateDate: String(structured?.rateDate || structured?.date || previous?.updatedAt || "").slice(0, 10),
    previousRateDate: String(structured?.previousRateDate || "").slice(0, 10),
    history: normalizeHistory(structured?.history),
  };
}

function mergeHistory(rate: StoredRate, fetched: RateHistoryPoint[], stored: RateHistoryPoint[]) {
  const merged = new Map<string, number>();
  for (const point of [...stored, ...fetched]) {
    if (point.date && point.effectiveRate > 0) merged.set(point.date, point.effectiveRate);
  }
  if (rate.rateDate && rate.effectiveRate > 0) merged.set(rate.rateDate, rate.effectiveRate);
  return [...merged]
    .map(([date, effectiveRate]) => ({ date, effectiveRate }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-5);
}

export async function refreshLiveExchangeRates() {
  const fetchedAt = new Date().toISOString();
  const previous = await readDataJson<any>("fees/exchange-rates.json", {});
  const rates = new Map<RateCode, StoredRate>();
  const historyByCode = new Map<RateCode, RateHistoryPoint[]>();
  const errors: string[] = [];

  try {
    const currentCbr = parseCbrXml(await fetchText("https://www.cbr.ru/scripts/XML_daily.asp"), fetchedAt);
    const snapshots = await fetchCbrSnapshots(currentCbr, fetchedAt, 5);
    for (const code of RATE_CODES) {
      const history = snapshots.flatMap((rows) => {
        const row = rows.find((item) => item.currency === code);
        return row ? [{ date: row.rateDate, effectiveRate: row.effectiveRate }] : [];
      });
      if (history.length) historyByCode.set(code, history);
    }
    const previousCbr = snapshots.length > 1 ? snapshots[snapshots.length - 2] : [];
    const previousByCode = new Map(previousCbr.map((rate) => [rate.currency, rate]));
    for (const rate of currentCbr) rates.set(rate.currency, attachPrevious(rate, previousByCode.get(rate.currency)));
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
    const prior = previousRate(previous, code);
    if (!rates.has(code)) {
      const fallback = legacyRate(code, prior.effectiveRate, fetchedAt);
      if (fallback) rates.set(code, fallback);
    }
    const current = rates.get(code);
    if (!current) continue;

    if (!current.previousEffectiveRate && prior.effectiveRate > 0) {
      current.previousEffectiveRate = prior.effectiveRate;
      current.previousRateDate = prior.rateDate;
      current.rateDelta = current.effectiveRate - prior.effectiveRate;
    }

    const unchangedFromStored = prior.effectiveRate > 0 && Math.abs(current.effectiveRate - prior.effectiveRate) < 1e-9;
    if (unchangedFromStored && prior.previousEffectiveRate > 0 && prior.rateDelta && Math.abs(prior.rateDelta) > 1e-9) {
      current.previousEffectiveRate = prior.previousEffectiveRate;
      current.previousRateDate = prior.previousRateDate || prior.rateDate;
      current.rateDelta = prior.rateDelta;
    } else if (current.previousEffectiveRate && current.rateDelta === undefined) {
      current.rateDelta = current.effectiveRate - current.previousEffectiveRate;
    }

    current.history = mergeHistory(current, historyByCode.get(code) || [], prior.history);
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
