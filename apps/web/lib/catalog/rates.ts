import { readDataJson } from "../data";

export type CurrencyRateSnapshot = {
  currency: string;
  cbrRate: number;
  nominal: number;
  effectiveRate: number;
  previousEffectiveRate?: number;
  previousRateDate?: string;
  rateDelta?: number;
  rateDate: string;
  fetchedAt?: string;
  rateSource: "moex" | "cbr" | "cbr_live" | "legacy_json" | "fallback_env";
  sourcePrice: number;
  sourcePriceRub: number;
};

const FALLBACK_ENV: Record<string, string> = {
  JPY: "CATALOG_FALLBACK_RATE_JPY_RUB",
  KRW: "CATALOG_FALLBACK_RATE_KRW_RUB",
  USD: "CATALOG_FALLBACK_RATE_USD_RUB",
  EUR: "CATALOG_FALLBACK_RATE_EUR_RUB",
  CNY: "CATALOG_FALLBACK_RATE_CNY_RUB",
  AED: "CATALOG_FALLBACK_RATE_AED_RUB",
  GBP: "CATALOG_FALLBACK_RATE_GBP_RUB",
  PLN: "CATALOG_FALLBACK_RATE_PLN_RUB",
  CHF: "CATALOG_FALLBACK_RATE_CHF_RUB",
  SEK: "CATALOG_FALLBACK_RATE_SEK_RUB",
  NOK: "CATALOG_FALLBACK_RATE_NOK_RUB",
  DKK: "CATALOG_FALLBACK_RATE_DKK_RUB",
  HUF: "CATALOG_FALLBACK_RATE_HUF_RUB",
  CZK: "CATALOG_FALLBACK_RATE_CZK_RUB",
  RON: "CATALOG_FALLBACK_RATE_RON_RUB",
  BGN: "CATALOG_FALLBACK_RATE_BGN_RUB",
  TRY: "CATALOG_FALLBACK_RATE_TRY_RUB",
  GEL: "CATALOG_FALLBACK_RATE_GEL_RUB",
  KZT: "CATALOG_FALLBACK_RATE_KZT_RUB",
  BYN: "CATALOG_FALLBACK_RATE_BYN_RUB",
  UAH: "CATALOG_FALLBACK_RATE_UAH_RUB",
  RSD: "CATALOG_FALLBACK_RATE_RSD_RUB",
  ISK: "CATALOG_FALLBACK_RATE_ISK_RUB",
  CAD: "CATALOG_FALLBACK_RATE_CAD_RUB",
  AUD: "CATALOG_FALLBACK_RATE_AUD_RUB",
  NZD: "CATALOG_FALLBACK_RATE_NZD_RUB",
  HKD: "CATALOG_FALLBACK_RATE_HKD_RUB",
  SGD: "CATALOG_FALLBACK_RATE_SGD_RUB",
};

type LiveRate = { cbrRate: number; nominal: number; effectiveRate: number; rateDate: string; fetchedAt: string };
let liveCbrRatesPromise: Promise<Map<string, LiveRate>> | null = null;

function validDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? value.slice(0, 10)
    : new Date().toISOString().slice(0, 10);
}

function optionalNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function xmlValue(block: string, tag: string) {
  return block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1]?.trim() || "";
}

function cbrXmlDate(xml: string) {
  const raw = xml.match(/<ValCurs[^>]+Date=["'](\d{2})\.(\d{2})\.(\d{4})["']/i);
  return raw ? `${raw[3]}-${raw[2]}-${raw[1]}` : new Date().toISOString().slice(0, 10);
}

async function fetchLiveCbrRates() {
  if (liveCbrRatesPromise) return liveCbrRatesPromise;
  liveCbrRatesPromise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.CATALOG_RATE_TIMEOUT_MS || 12_000));
    try {
      const response = await fetch("https://www.cbr.ru/scripts/XML_daily.asp", {
        headers: { accept: "application/xml,text/xml,*/*", "user-agent": "AvtoCenaCatalog/1.0" },
        redirect: "follow",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`cbr_rates_http_${response.status}`);
      const xml = await response.text();
      const rateDate = cbrXmlDate(xml);
      const fetchedAt = new Date().toISOString();
      const result = new Map<string, LiveRate>();
      for (const match of xml.matchAll(/<Valute\b[^>]*>([\s\S]*?)<\/Valute>/gi)) {
        const block = match[1];
        const currency = xmlValue(block, "CharCode").toUpperCase();
        const nominal = Number(xmlValue(block, "Nominal").replace(/[^0-9.]/g, ""));
        const cbrRate = Number(xmlValue(block, "Value").replace(/\s/g, "").replace(",", "."));
        if (!currency || !Number.isFinite(nominal) || nominal <= 0 || !Number.isFinite(cbrRate) || cbrRate <= 0) continue;
        result.set(currency, { cbrRate, nominal, effectiveRate: cbrRate / nominal, rateDate, fetchedAt });
      }
      if (!result.size) throw new Error("cbr_rates_empty");
      return result;
    } catch (error) {
      liveCbrRatesPromise = null;
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  })();
  return liveCbrRatesPromise;
}

export async function convertToRub(sourcePrice: number | null, currency: string | null): Promise<CurrencyRateSnapshot | null> {
  if (!sourcePrice || !currency) return null;
  const code = currency.toUpperCase().trim();
  if (code === "RUB") {
    return { currency: code, cbrRate: 1, nominal: 1, effectiveRate: 1, rateDate: new Date().toISOString().slice(0, 10), fetchedAt: new Date().toISOString(), rateSource: "cbr", sourcePrice, sourcePriceRub: Math.round(sourcePrice) };
  }

  const rates = await readDataJson<any>("fees/exchange-rates.json", {});
  const structured = Array.isArray(rates.rates)
    ? rates.rates.find((rate: any) => String(rate.currency).toUpperCase() === code)
    : rates[code] && typeof rates[code] === "object"
      ? rates[code]
      : null;

  if (structured) {
    const cbrRate = Number(structured.cbrRate ?? structured.value);
    const nominal = Number(structured.nominal || 1);
    if (cbrRate > 0 && nominal > 0) {
      const canonicalRate = cbrRate / nominal;
      const storedEffectiveRate = Number(structured.effectiveRate || 0);
      const storedRateIsConsistent = storedEffectiveRate > 0
        && Math.abs(storedEffectiveRate - canonicalRate) / canonicalRate <= 0.05;
      const effectiveRate = storedRateIsConsistent ? storedEffectiveRate : canonicalRate;
      const source = String(structured.rateSource || "cbr");
      return {
        currency: code,
        cbrRate,
        nominal,
        effectiveRate,
        previousEffectiveRate: optionalNumber(structured.previousEffectiveRate),
        previousRateDate: structured.previousRateDate ? validDate(structured.previousRateDate) : undefined,
        rateDelta: Number.isFinite(Number(structured.rateDelta)) ? Number(structured.rateDelta) : undefined,
        rateDate: validDate(structured.rateDate || structured.date || rates.updatedAt),
        fetchedAt: structured.fetchedAt || rates.updatedAt,
        rateSource: source === "moex" ? "moex" : source === "legacy_json" ? "legacy_json" : "cbr",
        sourcePrice,
        sourcePriceRub: Math.round(sourcePrice * effectiveRate),
      };
    }
  }

  const live = await fetchLiveCbrRates().then((map) => map.get(code)).catch(() => undefined);
  if (live) {
    return {
      currency: code,
      cbrRate: live.cbrRate,
      nominal: live.nominal,
      effectiveRate: live.effectiveRate,
      rateDate: live.rateDate,
      fetchedAt: live.fetchedAt,
      rateSource: "cbr_live",
      sourcePrice,
      sourcePriceRub: Math.round(sourcePrice * live.effectiveRate),
    };
  }

  const legacy = Number(rates[`${code}_RUB`]);
  if (legacy > 0) {
    return { currency: code, cbrRate: legacy, nominal: 1, effectiveRate: legacy, rateDate: validDate(rates.updatedAt), fetchedAt: rates.updatedAt, rateSource: "legacy_json", sourcePrice, sourcePriceRub: Math.round(sourcePrice * legacy) };
  }

  const envRate = Number(process.env[FALLBACK_ENV[code] || ""] || 0);
  if (envRate > 0) {
    return { currency: code, cbrRate: envRate, nominal: 1, effectiveRate: envRate, rateDate: new Date().toISOString().slice(0, 10), fetchedAt: new Date().toISOString(), rateSource: "fallback_env", sourcePrice, sourcePriceRub: Math.round(sourcePrice * envRate) };
  }
  return null;
}
