import { NextResponse } from "next/server";
import { readDataJson } from "@/lib/data";
import { convertToRub } from "@/lib/catalog/rates";
import { readCatalogFacets, searchOffers } from "@/lib/catalog/storage";

const RATE_CODES = ["JPY", "CNY", "KRW", "AED", "EUR", "GEL", "USD", "GBP", "PLN", "CHF", "SEK", "NOK", "DKK", "HUF", "CZK"];
const CBR_HISTORY_TTL_MS = 15 * 60_000;

type RatePoint = { date: string; effectiveRate: number };
type PublicRate = {
  currency: string;
  effectiveRate: number;
  previousEffectiveRate?: number;
  rateDelta?: number;
  rateDate?: string;
  previousRateDate?: string;
  history: RatePoint[];
};
type CbrSnapshot = { date: string; rates: Map<string, number> };

let cbrHistoryCache: { key: string; expiresAt: number; history: Map<string, RatePoint[]> } | null = null;
let cbrHistoryPromise: Promise<Map<string, RatePoint[]>> | null = null;

function n(v: string | null) {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : undefined;
}

function optionalPositive(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function optionalFinite(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function validIsoDate(value: unknown) {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function publicHistory(value: unknown) {
  if (!Array.isArray(value)) return [] as RatePoint[];
  return value.flatMap((point: any) => {
    const date = validIsoDate(point?.date || point?.rateDate);
    const effectiveRate = optionalPositive(point?.effectiveRate ?? point?.value);
    return date && effectiveRate ? [{ date, effectiveRate }] : [];
  }).sort((left, right) => left.date.localeCompare(right.date)).slice(-5);
}

function publicRates(raw: any): PublicRate[] {
  return RATE_CODES.flatMap((currency) => {
    const structured = Array.isArray(raw?.rates)
      ? raw.rates.find((rate: any) => String(rate?.currency || "").toUpperCase() === currency)
      : raw?.[currency] && typeof raw[currency] === "object"
        ? raw[currency]
        : null;
    const cbrRate = Number(structured?.cbrRate ?? structured?.value ?? 0);
    const nominal = Number(structured?.nominal || 1);
    const legacy = Number(raw?.[`${currency}_RUB`] || 0);
    const effectiveRate = Number(structured?.effectiveRate || (cbrRate > 0 && nominal > 0 ? cbrRate / nominal : legacy));
    if (!Number.isFinite(effectiveRate) || effectiveRate <= 0) return [];
    const previousEffectiveRate = optionalPositive(structured?.previousEffectiveRate);
    const rateDate = validIsoDate(structured?.rateDate || structured?.date || raw?.updatedAt);
    const previousRateDate = validIsoDate(structured?.previousRateDate) || undefined;
    const history = publicHistory(structured?.history);
    if (history.length < 2 && previousEffectiveRate && previousRateDate && rateDate) {
      history.splice(0, history.length,
        { date: previousRateDate, effectiveRate: previousEffectiveRate },
        { date: rateDate, effectiveRate },
      );
    }
    return [{ currency, effectiveRate, previousEffectiveRate, rateDelta: optionalFinite(structured?.rateDelta), rateDate, previousRateDate, history }];
  });
}

function parseCbrDate(value: string) {
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
}

function cbrRequestDate(value: string) {
  return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function parseCbrSnapshot(xml: string, requestedDate: string): CbrSnapshot {
  const publishedDate = parseCbrDate(xml.match(/<ValCurs[^>]+Date="([^"]+)"/i)?.[1] || "") || requestedDate;
  const rates = new Map<string, number>();
  for (const block of xml.match(/<Valute\b[\s\S]*?<\/Valute>/gi) || []) {
    const currency = String(block.match(/<CharCode>([\s\S]*?)<\/CharCode>/i)?.[1] || "").trim().toUpperCase();
    if (!RATE_CODES.includes(currency)) continue;
    const nominal = Number(String(block.match(/<Nominal>([\s\S]*?)<\/Nominal>/i)?.[1] || "1").replace(",", ".")) || 1;
    const value = Number(String(block.match(/<Value>([\s\S]*?)<\/Value>/i)?.[1] || "0").replace(",", "."));
    if (Number.isFinite(value) && value > 0 && nominal > 0) rates.set(currency, value / nominal);
  }
  return { date: publishedDate, rates };
}

async function fetchCbrSnapshot(requestedDate: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const url = new URL("https://www.cbr.ru/scripts/XML_daily.asp");
    url.searchParams.set("date_req", cbrRequestDate(requestedDate));
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: { accept: "application/xml,text/xml,*/*", "user-agent": "AvtoCenaRates/1.0 (+https://avtocena.com)" },
    });
    if (!response.ok) throw new Error(`cbr_history_http_${response.status}`);
    return parseCbrSnapshot(await response.text(), requestedDate);
  } finally {
    clearTimeout(timer);
  }
}

async function loadFivePublishedCbrDays(endDate: string) {
  const now = Date.now();
  if (cbrHistoryCache?.key === endDate && cbrHistoryCache.expiresAt > now) return cbrHistoryCache.history;
  if (cbrHistoryPromise) return cbrHistoryPromise;
  cbrHistoryPromise = (async () => {
    const requestedDates = Array.from({ length: 12 }, (_, index) => shiftDate(endDate, index - 11));
    const snapshots = (await Promise.all(requestedDates.map((date) => fetchCbrSnapshot(date).catch(() => null))))
      .filter((snapshot): snapshot is CbrSnapshot => Boolean(snapshot?.rates.size));
    const uniqueSnapshots = new Map<string, CbrSnapshot>();
    for (const snapshot of snapshots) uniqueSnapshots.set(snapshot.date, snapshot);
    const published = [...uniqueSnapshots.values()].sort((left, right) => left.date.localeCompare(right.date)).slice(-5);
    const history = new Map<string, RatePoint[]>();
    for (const currency of RATE_CODES) {
      const points = published.flatMap((snapshot) => {
        const effectiveRate = snapshot.rates.get(currency);
        return effectiveRate ? [{ date: snapshot.date, effectiveRate }] : [];
      });
      if (points.length) history.set(currency, points);
    }
    cbrHistoryCache = { key: endDate, expiresAt: Date.now() + CBR_HISTORY_TTL_MS, history };
    return history;
  })().finally(() => { cbrHistoryPromise = null; });
  return cbrHistoryPromise;
}

async function enrichRateHistory(rates: PublicRate[]): Promise<PublicRate[]> {
  const latestRateDate = rates.map((rate) => validIsoDate(rate.rateDate)).filter(Boolean).sort().at(-1) || new Date().toISOString().slice(0, 10);
  const historyByCurrency = await loadFivePublishedCbrDays(latestRateDate).catch(() => new Map<string, RatePoint[]>());
  return rates.map((rate) => {
    const currency = String(rate.currency || "").toUpperCase();
    const published = historyByCurrency.get(currency) || [];
    if (!published.length) return rate;
    const merged = new Map(published.map((point) => [point.date, point.effectiveRate]));
    const currentDate = validIsoDate(rate.rateDate);
    const currentRate = optionalPositive(rate.effectiveRate);
    if (currentDate && currentRate) merged.set(currentDate, currentRate);
    const history = [...merged]
      .map(([date, effectiveRate]) => ({ date, effectiveRate }))
      .sort((left, right) => left.date.localeCompare(right.date))
      .slice(-5);
    return { ...rate, history };
  });
}

export async function GET(request: Request) {
  const u = new URL(request.url);
  const p = u.searchParams;
  const result = await searchOffers({
    market: p.get("market") || undefined,
    make: p.get("make") || p.get("brand") || undefined,
    model: p.get("model") || undefined,
    budgetFrom: n(p.get("budgetFrom")),
    budgetTo: n(p.get("budgetTo") || p.get("budget")),
    yearFrom: n(p.get("yearFrom")),
    yearTo: n(p.get("yearTo")),
    mileageFrom: n(p.get("mileageFrom")),
    mileageTo: n(p.get("mileageTo")),
    engineFrom: n(p.get("engineFrom")),
    engineTo: n(p.get("engineTo")),
    powerFrom: n(p.get("powerFrom")),
    powerTo: n(p.get("powerTo")),
    fuel: p.get("fuel") || undefined,
    transmission: p.get("transmission") || undefined,
    drive: p.get("drive") || undefined,
    bodyType: p.get("bodyType") || p.get("body") || undefined,
    auctionGrade: p.get("auctionGrade") || undefined,
    sort: p.get("sort") || undefined,
    page: n(p.get("page")),
    pageSize: n(p.get("pageSize")),
  });

  const extras: Record<string, unknown> = {};
  if (p.get("includeRates") === "1") {
    const rawRates = await readDataJson<any>("fees/exchange-rates.json", {});
    let rates = publicRates(rawRates);
    if (!rates.some((rate) => rate.currency === "GEL")) {
      const liveGel = await convertToRub(1, "GEL").catch(() => null);
      if (liveGel) {
        rates.push({
          currency: "GEL",
          effectiveRate: liveGel.effectiveRate,
          previousEffectiveRate: liveGel.previousEffectiveRate,
          rateDelta: liveGel.rateDelta,
          rateDate: validIsoDate(liveGel.rateDate),
          previousRateDate: validIsoDate(liveGel.previousRateDate) || undefined,
          history: [],
        });
      }
    }
    rates = await enrichRateHistory(rates);
    extras.rates = rates;
    extras.ratesUpdatedAt = rawRates?.updatedAt || null;
  }
  if (p.get("includeFacets") === "1") extras.facets = await readCatalogFacets();
  return NextResponse.json({ ok: true, ...result, ...extras });
}
