import type { PublicCurrencyRate } from "../../components/catalog/PriceTrend";

const TTL_MS = 15 * 60_000;
let cached: PublicCurrencyRate[] | null = null;
let expiresAt = 0;
let inFlight: Promise<PublicCurrencyRate[]> | null = null;

// Shared by desktop/mobile strips, price trends and chart annotations.
export function loadPublicRates(): Promise<PublicCurrencyRate[]> {
  if (cached && expiresAt > Date.now()) return Promise.resolve(cached);
  if (!inFlight) {
    inFlight = fetch("/api/catalog/rates").then(async response => {
      if (!response.ok) throw new Error("public_rates_unavailable");
      const data = await response.json();
      if (!Array.isArray(data?.rates)) throw new Error("public_rates_invalid");
      cached = data.rates.filter((rate: PublicCurrencyRate) => rate?.currency && Number(rate.effectiveRate) > 0);
      expiresAt = Date.now() + TTL_MS;
      return cached!;
    }).finally(() => { inFlight = null; });
  }
  return inFlight;
}
