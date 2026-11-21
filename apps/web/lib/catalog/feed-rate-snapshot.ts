import type {CurrencyRateSnapshot} from './rates';

type Unit = Omit<CurrencyRateSnapshot, 'sourcePrice' | 'sourcePriceRub'>;
export type FeedRates = {version:1; market:string; runId:string; capturedAt:string; rates:Record<string, Unit>};
let active: FeedRates | undefined;

// Only an isolated import/publisher process installs a rate table.
export function installFeedRates(snapshot: FeedRates) {
 if (snapshot.version !== 1 || !snapshot.rates || !snapshot.rates.RUB || !Number.isFinite(Date.parse(snapshot.capturedAt)))
  throw Error('invalid_feed_rate_snapshot');
 for (const [code, rate] of Object.entries(snapshot.rates)) {
  if (rate.currency !== code || !Number.isFinite(rate.effectiveRate) || rate.effectiveRate <= 0)
   throw Error('invalid_feed_exchange_rate');
 }
 active = snapshot;
}

export function frozenConversion(amount:number, currency:string): CurrencyRateSnapshot | null | undefined {
 if (!active) return undefined;
 const unit = active.rates[currency];
 if (!unit) return null;
 return {...unit, sourcePrice:amount, sourcePriceRub:Math.round(amount * unit.effectiveRate)};
}
