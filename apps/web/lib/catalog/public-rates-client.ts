import type { PublicCurrencyRate } from "../../components/catalog/PriceTrend";

const TTL_MS = 60_000;
let cached: PublicCurrencyRate[] | null = null;
let expiresAt = 0;
let inFlight: Promise<PublicCurrencyRate[]> | null = null;
let stopWatching: (()=>void) | null = null;
const listeners = new Set<(rates: PublicCurrencyRate[]) => void>();
export function subscribePublicRates(listener: (rates: PublicCurrencyRate[]) => void) {
  listeners.add(listener);
  if(typeof window!=="undefined"&&!stopWatching){
    const refresh=()=>{if(document.visibilityState!=="hidden")void loadPublicRates().catch(()=>{});};
    const timer=setInterval(refresh,TTL_MS);
    window.addEventListener("focus",refresh);document.addEventListener("visibilitychange",refresh);
    stopWatching=()=>{clearInterval(timer);window.removeEventListener("focus",refresh);document.removeEventListener("visibilitychange",refresh);};
  }
  return () => { listeners.delete(listener);if(!listeners.size){stopWatching?.();stopWatching=null;} };
}

// Shared by desktop/mobile strips, price trends and chart annotations.
export function loadPublicRates(): Promise<PublicCurrencyRate[]> {
  if (cached && expiresAt > Date.now()) return Promise.resolve(cached);
  if (!inFlight) {
    inFlight = fetch("/api/catalog/rates",{cache:"no-store"}).then(async response => {
      if (!response.ok) throw new Error("public_rates_unavailable");
      const data = await response.json();
      if (!Array.isArray(data?.rates)) throw new Error("public_rates_invalid");
      cached = data.rates.filter((rate: PublicCurrencyRate) => rate?.currency && Number(rate.effectiveRate) > 0);
      expiresAt = Date.now() + TTL_MS;
      listeners.forEach(listener => listener(cached!));
      return cached!;
    }).finally(() => { inFlight = null; });
  }
  return inFlight;
}
