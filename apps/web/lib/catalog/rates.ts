import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
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
  rateSource: "atb_akebono" | "moex" | "cbr" | "cbr_live" | "legacy_json" | "fallback_env";
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

const frozenMarkets = new Set(["china", "korea", "uae", "europe", "georgia"]);
type FrozenRate = Readonly<Omit<CurrencyRateSnapshot, "sourcePrice" | "sourcePriceRub">>;
// observedAt is the end of this FX observation, not the supplier's source time.
// Source generations retain sourceObservedAt separately; an older saved source
// can be priced later without rewriting or making its observation appear fresh.
type FxReceipt = Readonly<{version: 1; market: string; runId: string; pricingAsOf: string; observedAt: string; rates: Readonly<Record<string, FrozenRate>>}>;
export type CatalogFxBatch = Readonly<{receipt: FxReceipt; receiptSha256: string}>;
const frozenFx = new AsyncLocalStorage<CatalogFxBatch>();
const issuedFxBatches = new WeakSet<CatalogFxBatch>();
const fxDigest = (receipt: unknown) => createHash("sha256").update(JSON.stringify(receipt)).digest("hex");

/** Capture rates and the calculation clock once. Other pricing inputs must be
 * staged as immutable local files by the offline runner. An independent rate
 * cache shares one observation in this run, never a previous run's promise. */
export async function captureCatalogFxBatch(market: string, sourceCurrencies: readonly string[]): Promise<CatalogFxBatch> {
  return (await captureCatalogFxBatches({[market]: sourceCurrencies}))[market];
}

export async function captureCatalogFxBatches(plan: Readonly<Record<string, readonly string[]>>): Promise<Record<string, CatalogFxBatch>> {
  const entries = Object.entries(plan);
  if (!entries.length || entries.some(([market]) => !frozenMarkets.has(market)) || frozenFx.getStore()) throw Error("catalog_fx_batch_scope");
  const byMarket = entries.map(([market, sourceCurrencies]) => [market, [...new Set([
    "EUR", "RUB", "USD", ...(market === "china" ? ["CNY"] : []), ...sourceCurrencies.map(value => value.trim().toUpperCase()),
  ])].sort()] as const);
  const codes = [...new Set(byMarket.flatMap(([, currencies]) => currencies))].sort();
  if (codes.some(code => code !== "RUB" && !Object.hasOwn(FALLBACK_ENV, code))) throw Error("catalog_fx_batch_currency");
  const runId = randomUUID(), pricingAsOf = new Date().toISOString(), cache = emptyResolverCache();
  const pairs = await Promise.all(codes.map(async code => {
    const rate = await resolveRate(1, code, {preferLive: code === "USD", requireDatedOfficial: true}, cache);
    if (!rate || !["cbr", "cbr_live"].includes(rate.rateSource) ||
        ![rate.effectiveRate, rate.cbrRate, rate.nominal].every(value => Number.isFinite(value) && value > 0) ||
        !Number.isFinite(Date.parse(rate.rateDate))) throw Error(`catalog_fx_authority_unavailable:${code}`);
    const {sourcePrice: _sourcePrice, sourcePriceRub: _sourcePriceRub, ...quote} = rate;
    return [code, Object.freeze(quote)] as const;
  }));
  const observedAt = new Date().toISOString(), allRates = Object.fromEntries(pairs);
  return Object.fromEntries(byMarket.map(([market, currencies]) => {
    const receipt: FxReceipt = Object.freeze({version: 1, market, runId, pricingAsOf, observedAt,
      rates: Object.freeze(Object.fromEntries(currencies.map(code => [code, allRates[code]])))});
    return [market, issueFxBatch(receipt)];
  }));
}

function issueFxBatch(receipt: FxReceipt): CatalogFxBatch {
  const result = Object.freeze({receipt, receiptSha256: fxDigest(receipt)});
  issuedFxBatches.add(result);
  return result;
}

/** Reconstitute only after the runner authenticates the independent transport
 * digest. A digest supplied by the same untrusted object is not authority. */
export function importCatalogFxBatch(wire: CatalogFxBatch, expectedDigest: string): CatalogFxBatch {
  const r = wire?.receipt, fail = () => { throw Error("catalog_fx_receipt_mismatch"); };
  const validTimestamp = (value: string) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  if (!r || !/^[a-f0-9]{64}$/.test(expectedDigest) || wire.receiptSha256 !== expectedDigest || fxDigest(r) !== expectedDigest ||
      r.version !== 1 || !frozenMarkets.has(r.market) || !/^[a-f0-9-]{36}$/.test(r.runId) ||
      !validTimestamp(r.pricingAsOf) || !validTimestamp(r.observedAt) || r.observedAt < r.pricingAsOf || !r.rates ||
      !["EUR","RUB","USD",...(r.market === "china" ? ["CNY"] : [])].every(code => Object.hasOwn(r.rates, code))) return fail();
  const rates = structuredClone(r.rates);
  for (const [code, quote] of Object.entries(rates)) {
    if ((!Object.hasOwn(FALLBACK_ENV, code) && code !== "RUB") || quote?.currency !== code ||
        !["cbr","cbr_live"].includes(quote.rateSource) || !isExactRateDate(quote.rateDate) ||
        ![quote.cbrRate,quote.nominal,quote.effectiveRate].every(n => Number.isFinite(n) && n > 0) ||
        quote.effectiveRate !== quote.cbrRate / quote.nominal || (code === "RUB" && quote.effectiveRate !== 1)) return fail();
    Object.freeze(quote);
  }
  return issueFxBatch(Object.freeze({...r,rates:Object.freeze(rates)}));
}

export function withCatalogFxBatch<T>(batch: CatalogFxBatch, task: () => T): T {
  if (!issuedFxBatches.has(batch) || frozenFx.getStore()) throw Error("catalog_fx_batch_scope");
  return frozenFx.run(batch, task);
}

/** Compare authority read back from the same run, not current wall-clock FX. */
export function verifyCatalogFxReadback(batch: CatalogFxBatch, receipt: unknown, receiptSha256: string) {
  if (!issuedFxBatches.has(batch) || receiptSha256 !== batch.receiptSha256 || !receipt || fxDigest(receipt) !== receiptSha256)
    throw Error("catalog_fx_receipt_mismatch");
}

export const activeCatalogFxBatch = () => frozenFx.getStore();
export const catalogPricingNow = () => {
  const batch = activeCatalogFxBatch();
  return batch ? Date.parse(batch.receipt.pricingAsOf) : Date.now();
};

/** Actual conversion authority, including freshness transitions, without fetch timestamps. */
export async function catalogRateFingerprintInputs() {
  const batch = activeCatalogFxBatch();
  const currencies = batch ? Object.keys(batch.receipt.rates) : [...Object.keys(FALLBACK_ENV), "RUB"];
  return Promise.all(currencies.map(async currency => {
    const rate = await convertToRub(1, currency).catch(() => null);
    if (!rate) return [currency, null];
    const {fetchedAt: _fetchedAt, ...value} = rate;
    return [currency, value, Math.abs(catalogPricingNow() - Date.parse(rate.rateDate)) <= 4 * 86400000];
  }));
}

type LiveRate = { cbrRate: number; nominal: number; effectiveRate: number; rateDate: string; fetchedAt: string; explicitDate: boolean };
type RateResolverCache = {
  live: Promise<Map<string, LiveRate>> | null; stored: Promise<any> | null;
  storedExpires: number; liveExpires: number; liveRetry: number;
};
const emptyResolverCache = (): RateResolverCache => ({live: null, stored: null, storedExpires: 0, liveExpires: 0, liveRetry: 0});
const sharedRateResolver = emptyResolverCache();
const RATE_CACHE_MS = 5 * 60_000;

function validDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? value.slice(0, 10)
    : new Date().toISOString().slice(0, 10);
}

function optionalNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function liveRatesDisabled() {
  return /^(?:1|true|yes|on)$/i.test(String(process.env.CATALOG_LIVE_RATE_DISABLED || ""));
}

function storedRateIsFresh(value: unknown) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) return false;
  const maxAgeMs = Math.max(24 * 60 * 60 * 1_000, Number(process.env.CATALOG_RATE_MAX_AGE_MS || 4 * 24 * 60 * 60 * 1_000));
  return timestamp >= Date.now() - maxAgeMs;
}

function xmlValue(block: string, tag: string) {
  return block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1]?.trim() || "";
}

function isExactRateDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function cbrXmlDate(xml: string) {
  const raw = xml.match(/<ValCurs[^>]+Date=["'](\d{2})\.(\d{2})\.(\d{4})["']/i);
  return raw ? `${raw[3]}-${raw[2]}-${raw[1]}` : null;
}

async function readStoredRates(cache: RateResolverCache) {
  if (!cache.stored || Date.now() >= cache.storedExpires) {
    cache.storedExpires = Date.now() + RATE_CACHE_MS;
    cache.stored = readDataJson<any>("fees/exchange-rates.json", {}).catch((error) => {
      cache.stored = null;
      throw error;
    });
  }
  return cache.stored;
}

export function resetCatalogRateCache() {
  Object.assign(sharedRateResolver, emptyResolverCache());
}

async function fetchLiveCbrRates(cache: RateResolverCache) {
  if (cache.live && Date.now() < cache.liveExpires) return cache.live;
  if (Date.now() < cache.liveRetry) return new Map<string, LiveRate>();
  cache.liveExpires = Date.now() + RATE_CACHE_MS;
  cache.live = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.CATALOG_RATE_TIMEOUT_MS || 12_000));
    try {
      const response = await fetch("https://www.cbr.ru/scripts/XML_daily.asp", {
        cache: "no-store",
        headers: { accept: "application/xml,text/xml,*/*", "user-agent": "AvtoCenaCatalog/1.0" },
        redirect: "follow",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`cbr_rates_http_${response.status}`);
      const xml = await response.text();
      const publishedDate = cbrXmlDate(xml);
      const rateDate = publishedDate || new Date().toISOString().slice(0, 10);
      const fetchedAt = new Date().toISOString();
      const result = new Map<string, LiveRate>();
      for (const match of xml.matchAll(/<Valute\b[^>]*>([\s\S]*?)<\/Valute>/gi)) {
        const block = match[1];
        const currency = xmlValue(block, "CharCode").toUpperCase();
        const nominal = Number(xmlValue(block, "Nominal").replace(/[^0-9.]/g, ""));
        const cbrRate = Number(xmlValue(block, "Value").replace(/\s/g, "").replace(",", "."));
        if (!currency || !Number.isFinite(nominal) || nominal <= 0 || !Number.isFinite(cbrRate) || cbrRate <= 0) continue;
        result.set(currency, { cbrRate, nominal, effectiveRate: cbrRate / nominal, rateDate, fetchedAt, explicitDate: isExactRateDate(publishedDate) });
      }
      if (!result.size) throw new Error("cbr_rates_empty");
      return result;
    } catch (error) {
      cache.live = null;
      // Failed official requests remain failures; only suppress a request storm.
      // Callers still enforce freshness and never publish a fallback as ready.
      cache.liveRetry = Date.now() + 30_000;
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  })();
  return cache.live;
}

export async function convertToRub(
  sourcePrice: number | null,
  currency: string | null,
  options: { preferLive?: boolean } = {},
): Promise<CurrencyRateSnapshot | null> {
  if (!sourcePrice || !currency) return null;
  const batch = activeCatalogFxBatch();
  if (!batch) return resolveRate(sourcePrice, currency, options, sharedRateResolver);
  const code = currency.toUpperCase().trim();
  const rate = batch.receipt.rates[code];
  if (!rate || !Object.hasOwn(batch.receipt.rates, code)) throw Error(`catalog_fx_unsealed_currency:${code}`);
  return { ...rate, sourcePrice, sourcePriceRub: Math.round(sourcePrice * rate.effectiveRate) };
}

async function resolveRate(sourcePrice: number, currency: string, options: {preferLive?: boolean; requireDatedOfficial?: boolean}, cache: RateResolverCache): Promise<CurrencyRateSnapshot | null> {
  const code = currency.toUpperCase().trim();
  if (code === "RUB") {
    return { currency: code, cbrRate: 1, nominal: 1, effectiveRate: 1, rateDate: new Date().toISOString().slice(0, 10), fetchedAt: new Date().toISOString(), rateSource: "cbr", sourcePrice, sourcePriceRub: Math.round(sourcePrice) };
  }

  const rates = await readStoredRates(cache);
  const structured = Array.isArray(rates.rates)
    ? rates.rates.find((rate: any) => String(rate.currency).toUpperCase() === code)
    : rates[code] && typeof rates[code] === "object"
      ? rates[code]
      : null;

  // A stored snapshot is a cache, not permanent calculation authority. Market
  // recovery may be idle for several days, so try the official current CBR
  // publication before reusing a stale snapshot. The stored value remains the
  // fail-safe when CBR is temporarily unavailable.
  const structuredDate = structured?.rateDate || structured?.date || rates.updatedAt;
  const publishedDate = structured?.rateDate || structured?.date;
  const storedNominal = Number(structured?.nominal);
  const datedOfficialStored = isExactRateDate(publishedDate) && ["cbr", "cbr_live"].includes(structured?.rateSource)
    && Number.isFinite(storedNominal) && storedNominal > 0;
  const official = !structured?.rateSource || String(structured.rateSource).startsWith("cbr");
  // A recent stored date is a fallback, not proof that no newer publication
  // exists. All consumers share one in-flight request and a five-minute cache.
  if (!liveRatesDisabled() && (options.preferLive || official || !storedRateIsFresh(structuredDate))) {
    const live = await fetchLiveCbrRates(cache).then((map) => map.get(code)).catch(() => undefined);
    if (live && (!options.requireDatedOfficial || live.explicitDate) &&
        (!structuredDate || (options.requireDatedOfficial && !datedOfficialStored) || live.rateDate >= String(structuredDate).slice(0,10))) {
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
  }

  if (structured && (!options.requireDatedOfficial || datedOfficialStored)) {
    const cbrRate = Number(structured.cbrRate ?? structured.value);
    const nominal = Number(structured.nominal || 1);
    if (cbrRate > 0 && nominal > 0) {
      // A cached effectiveRate must never add a spread to the published quote.
      // Exchange reserves belong to the existing separate cost breakdown.
      const effectiveRate = cbrRate / nominal;
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
        rateSource: source === "moex" ? "moex" : source === "legacy_json" ? "legacy_json" : options.requireDatedOfficial && source === "cbr_live" ? "cbr_live" : "cbr",
        sourcePrice,
        sourcePriceRub: Math.round(sourcePrice * effectiveRate),
      };
    }
  }

  const live = liveRatesDisabled()
    ? undefined
    : await fetchLiveCbrRates(cache).then((map) => map.get(code)).catch(() => undefined);
  if (live && (!options.requireDatedOfficial || live.explicitDate)) {
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

  if (options.requireDatedOfficial) return null;

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
