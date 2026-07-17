import { NextResponse } from "next/server";
import { readDataJson } from "@/lib/data";
import { searchOffers } from "@/lib/catalog/storage";

const RATE_CODES = ["JPY", "CNY", "KRW", "AED", "EUR"];

function n(v: string | null) {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : undefined;
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
    return [{
      currency,
      effectiveRate,
      rateDate: String(structured?.rateDate || structured?.date || raw?.updatedAt || "").slice(0, 10),
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
    mileageTo: n(p.get("mileageTo")),
    fuel: p.get("fuel") || undefined,
    transmission: p.get("transmission") || undefined,
    drive: p.get("drive") || undefined,
    bodyType: p.get("bodyType") || p.get("body") || undefined,
    auctionGrade: p.get("auctionGrade") || undefined,
    sort: p.get("sort") || undefined,
    page: n(p.get("page")),
    pageSize: n(p.get("pageSize")),
  });

  if (p.get("includeRates") === "1") {
    const rawRates = await readDataJson<any>("fees/exchange-rates.json", {});
    return NextResponse.json({ ok: true, ...result, rates: publicRates(rawRates), ratesUpdatedAt: rawRates?.updatedAt || null });
  }

  return NextResponse.json({ ok: true, ...result });
}
