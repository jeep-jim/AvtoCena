import { readDataJson } from "../data";
export type CurrencyRateSnapshot = { currency: string; cbrRate: number; nominal: number; effectiveRate: number; rateDate: string; rateSource: "cbr" | "fallback_env"; sourcePrice: number; sourcePriceRub: number };
const FALLBACK_ENV: Record<string, string> = { JPY: "CATALOG_FALLBACK_RATE_JPY_RUB", KRW: "CATALOG_FALLBACK_RATE_KRW_RUB", USD: "CATALOG_FALLBACK_RATE_USD_RUB", EUR: "CATALOG_FALLBACK_RATE_EUR_RUB", CNY: "CATALOG_FALLBACK_RATE_CNY_RUB", AED: "CATALOG_FALLBACK_RATE_AED_RUB" };
export async function convertToRub(sourcePrice: number | null, currency: string | null): Promise<CurrencyRateSnapshot | null> {
  if (!sourcePrice || !currency) return null;
  const code = currency.toUpperCase();
  if (code === "RUB") return { currency: code, cbrRate: 1, nominal: 1, effectiveRate: 1, rateDate: new Date().toISOString().slice(0,10), rateSource: "cbr", sourcePrice, sourcePriceRub: Math.round(sourcePrice) };
  const rates = await readDataJson<any>("fees/exchange-rates.json", {});
  const direct = rates[`${code}_RUB`];
  const nominal = Number(rates[`${code}_NOMINAL`] || (code === "JPY" ? 100 : 1));
  if (Number.isFinite(Number(direct)) && Number(direct) > 0) {
    const cbrRate = Number(direct); const effectiveRate = cbrRate / nominal;
    return { currency: code, cbrRate, nominal, effectiveRate, rateDate: String(rates.updatedAt || new Date().toISOString().slice(0,10)), rateSource: "cbr", sourcePrice, sourcePriceRub: Math.round(sourcePrice * effectiveRate) };
  }
  const envRate = Number(process.env[FALLBACK_ENV[code] || ""] || 0);
  if (envRate > 0) return { currency: code, cbrRate: envRate, nominal: 1, effectiveRate: envRate, rateDate: new Date().toISOString().slice(0,10), rateSource: "fallback_env", sourcePrice, sourcePriceRub: Math.round(sourcePrice * envRate) };
  return null;
}
