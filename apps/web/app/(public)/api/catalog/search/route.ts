import { NextResponse } from "next/server";
import { readDataJson } from "@/lib/data";
import { convertToRub } from "@/lib/catalog/rates";
import { readCatalogFacets, searchOffers } from "@/lib/catalog/storage";

const RATE_CODES = ["JPY", "CNY", "KRW", "AED", "EUR", "GEL", "USD", "GBP", "PLN", "CHF", "SEK", "NOK", "DKK", "HUF", "CZK"];

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

function publicHistory(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((point: any) => {
    const date = String(point?.date || point?.rateDate || "").slice(0, 10);
    const effectiveRate = optionalPositive(point?.effectiveRate ?? point?.value);
    return date && effectiveRate ? [{ date, effectiveRate }] : [];
  }).sort((left, right) => left.date.localeCompare(right.date)).slice(-5);
}

function publicRates(raw: any) {
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
    const rateDate = String(structured?.rateDate || structured?.date || raw?.updatedAt || "").slice(0, 10);
    const previousRateDate = String(structured?.previousRateDate || "").slice(0, 10) || undefined;
    const history = publicHistory(structured?.history);
    if (history.length < 2 && previousEffectiveRate && previousRateDate && rateDate) {
      history.splice(0, history.length,
        { date: previousRateDate, effectiveRate: previousEffectiveRate },
        { date: rateDate, effectiveRate },
      );
    }
    return [{
      currency,
      effectiveRate,
      previousEffectiveRate,
      rateDelta: optionalFinite(structured?.rateDelta),
      rateDate,
      previousRateDate,
      history,
    }];
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
    const rates = publicRates(rawRates);
    if (!rates.some((rate) => rate.currency === "GEL")) {
      const liveGel = await convertToRub(1, "GEL").catch(() => null);
      if (liveGel) {
        rates.push({
          currency: "GEL",
          effectiveRate: liveGel.effectiveRate,
          previousEffectiveRate: liveGel.previousEffectiveRate,
          rateDelta: liveGel.rateDelta,
          rateDate: liveGel.rateDate,
          previousRateDate: liveGel.previousRateDate,
          history: [],
        });
      }
    }
    extras.rates = rates;
    extras.ratesUpdatedAt = rawRates?.updatedAt || null;
  }
  if (p.get("includeFacets") === "1") extras.facets = await readCatalogFacets();

  return NextResponse.json({ ok: true, ...result, ...extras });
}
