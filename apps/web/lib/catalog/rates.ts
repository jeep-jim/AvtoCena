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
  rateSource: "moex" | "cbr" | "legacy_json" | "fallback_env";
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
};

function validDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? value.slice(0, 10)
    : new Date().toISOString().slice(0, 10);
}

function optionalNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export async function convertToRub(sourcePrice: number | null, currency: string | null): Promise<CurrencyRateSnapshot | null> {
  if (!sourcePrice || !currency) return null;
  const code = currency.toUpperCase();
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
