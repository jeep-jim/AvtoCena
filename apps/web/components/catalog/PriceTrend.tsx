"use client";

import { useEffect, useMemo, useState } from "react";

type CurrencyRateLike = {
  currency?: string;
  effectiveRate?: number;
  previousEffectiveRate?: number;
  rateDelta?: number;
  rateDate?: string;
  previousRateDate?: string;
};

type PriceLike = {
  totalRub?: number | null;
  previousTotalRub?: number | null;
  priceDeltaRub?: number | null;
  priceChangedAt?: string;
  sourcePrice?: number | null;
  sourceCurrency?: string | null;
  calculationSnapshot?: {
    currencyRate?: CurrencyRateLike;
  } | null;
};

type LiveRate = Required<Pick<CurrencyRateLike, "currency" | "effectiveRate">> & CurrencyRateLike;

export type PriceTrendDirection = "up" | "down";

export type PriceTrendValue = {
  direction: PriceTrendDirection;
  deltaRub: number;
  formattedDelta: string;
};

let ratesPromise: Promise<Record<string, LiveRate>> | null = null;

function loadLiveRates() {
  if (!ratesPromise) {
    ratesPromise = fetch("/api/catalog/search?pageSize=1&includeRates=1", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => Object.fromEntries(
        (Array.isArray(data?.rates) ? data.rates : [])
          .filter((rate: any) => rate?.currency && Number(rate?.effectiveRate) > 0)
          .map((rate: LiveRate) => [String(rate.currency).toUpperCase(), rate]),
      ))
      .catch(() => ({}));
  }
  return ratesPromise;
}

function money(value: number) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(value));
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function savedPriceDelta(offer: PriceLike) {
  const current = Number(offer.totalRub || 0);
  const explicitDelta = Number(offer.priceDeltaRub || 0);
  const previous = Number(offer.previousTotalRub || 0);
  return explicitDelta || (current && previous ? current - previous : 0);
}

function currencyDelta(offer: PriceLike) {
  const current = Number(offer.totalRub || 0);
  const sourcePrice = Number(offer.sourcePrice || 0);
  const rate = offer.calculationSnapshot?.currencyRate;
  const effectiveRate = Number(rate?.effectiveRate || 0);
  const previousEffectiveRate = Number(rate?.previousEffectiveRate || 0);
  const explicitRateDelta = finiteNumber(rate?.rateDelta);
  const rateDelta = Math.abs(explicitRateDelta) > 1e-9
    ? explicitRateDelta
    : effectiveRate && previousEffectiveRate
      ? effectiveRate - previousEffectiveRate
      : 0;
  if (!Number.isFinite(rateDelta) || Math.abs(rateDelta) < 1e-9) return 0;

  const estimatedSourcePrice = sourcePrice || (current && effectiveRate ? current / effectiveRate : 0);
  return estimatedSourcePrice ? Math.round(estimatedSourcePrice * rateDelta) : 0;
}

function formatDelta(value: number) {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) {
    return `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(absolute / 1_000_000)}M`;
  }
  if (absolute >= 1_000) {
    return `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(absolute / 1_000)}K`;
  }
  return `${money(absolute)} ₽`;
}

function withLiveRate(offer: PriceLike, liveRate: LiveRate | null): PriceLike {
  if (!liveRate) return offer;
  const stored = offer.calculationSnapshot?.currencyRate || {};
  const liveEffective = Number(liveRate.effectiveRate || 0);
  const storedEffective = Number(stored.effectiveRate || 0);
  let previousEffectiveRate = Number(liveRate.previousEffectiveRate || 0) || Number(stored.previousEffectiveRate || 0);
  let rateDelta = finiteNumber(liveRate.rateDelta);

  if (Math.abs(rateDelta) < 1e-9 && liveEffective && storedEffective && Math.abs(liveEffective - storedEffective) > 1e-9) {
    previousEffectiveRate = storedEffective;
    rateDelta = liveEffective - storedEffective;
  }
  if (Math.abs(rateDelta) < 1e-9 && Math.abs(finiteNumber(stored.rateDelta)) > 1e-9) {
    rateDelta = finiteNumber(stored.rateDelta);
    previousEffectiveRate = Number(stored.previousEffectiveRate || 0) || previousEffectiveRate;
  }

  return {
    ...offer,
    calculationSnapshot: {
      ...(offer.calculationSnapshot || {}),
      currencyRate: {
        ...stored,
        ...liveRate,
        effectiveRate: liveEffective || storedEffective,
        previousEffectiveRate: previousEffectiveRate || undefined,
        rateDelta: Math.abs(rateDelta) > 1e-9 ? rateDelta : undefined,
      },
    },
  };
}

export function resolvePriceTrend(offer: PriceLike): PriceTrendValue | null {
  const current = Number(offer.totalRub || 0);
  const delta = savedPriceDelta(offer) || currencyDelta(offer);
  if (!current || !Number.isFinite(delta) || Math.abs(delta) < 1) return null;

  return {
    direction: delta < 0 ? "down" : "up",
    deltaRub: delta,
    formattedDelta: formatDelta(delta),
  };
}

function TrendArrow({ direction, className = "" }: { direction: PriceTrendDirection; className?: string }) {
  const down = direction === "down";
  return (
    <svg className={className} width="38" height="29" viewBox="0 0 38 29" fill="none" aria-hidden="true">
      <path
        d={down ? "M3 5L11.5 13.5L18 9L34 25" : "M3 25L11.5 16.5L18 21L34 5"}
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={down ? "M25 25H34V16" : "M25 5H34V14"}
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PriceTrend({
  offer,
  label = "Ориентир",
  priceClassName = "text-[22px]",
  className = "",
  panel = false,
  dense = false,
}: {
  offer: PriceLike;
  label?: string;
  priceClassName?: string;
  className?: string;
  panel?: boolean;
  dense?: boolean;
}) {
  const currency = String(offer.sourceCurrency || offer.calculationSnapshot?.currencyRate?.currency || "").toUpperCase();
  const [liveRate, setLiveRate] = useState<LiveRate | null>(null);

  useEffect(() => {
    if (!currency || currency === "RUB") return;
    let active = true;
    void loadLiveRates().then((rates) => {
      if (active) setLiveRate(rates[currency] || null);
    });
    return () => { active = false; };
  }, [currency]);

  const pricedOffer = useMemo(() => withLiveRate(offer, liveRate), [offer, liveRate]);
  const trend = resolvePriceTrend(pricedOffer);
  const direction = trend?.direction;
  const stateClass = direction === "down" ? "is-down" : direction === "up" ? "is-up" : "is-flat";
  const priceStateClass = direction === "down" ? "ac-price--down" : direction === "up" ? "ac-price--up" : "ac-price--flat";
  const hasPrice = Boolean(pricedOffer.totalRub);
  const trendUsesCurrency = Boolean(trend) && !savedPriceDelta(pricedOffer) && Boolean(currencyDelta(pricedOffer));
  const trendTitle = trend
    ? trendUsesCurrency
      ? "Изменение расчёта из-за обновления валютного курса"
      : "Изменение относительно предыдущего сохранённого расчёта"
    : "Ожидается следующий снимок валютного курса";

  return (
    <div className={`${panel ? "ac-price-trend-panel rounded-[1.35rem] p-4 shadow-[0_14px_38px_rgba(0,0,0,.14)]" : ""} ${stateClass} ${className}`}>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className={`${dense ? "text-[8px] sm:text-[10px]" : panel ? "text-[10px] md:text-[11px]" : "text-[10px]"} ac-price-trend-label min-w-0 font-black uppercase tracking-[0.19em] text-[var(--ac-text)]`}>{label}</div>
        {trend ? (
          <span
            className={`${dense ? "text-[9px] sm:text-xs" : "text-xs md:text-sm"} ac-price-trend-delta shrink-0 font-black leading-none`}
            title={trendTitle}
            aria-label={`Цена ${trend.direction === "down" ? "снизилась" : "выросла"} на ${trend.formattedDelta}`}
          >
            {trend.direction === "down" ? "−" : "+"}{trend.formattedDelta}
          </span>
        ) : null}
      </div>
      <div className={`${dense ? "mt-1 gap-1 sm:mt-1.5 sm:gap-3" : "mt-1.5 gap-3"} flex min-w-0 items-end justify-between`}>
        <div className={`ac-price ${priceStateClass} min-w-0 font-black leading-none tracking-[-0.05em] ${hasPrice ? "whitespace-nowrap" : "break-words"} ${priceClassName}`}>
          {hasPrice ? (
            <>
              <span>{money(Number(pricedOffer.totalRub))}</span>
              <span className="ml-[0.18em] inline-block translate-y-[-0.03em] text-[0.58em] tracking-[-0.02em]">₽</span>
            </>
          ) : (
            "Цена уточняется"
          )}
        </div>
        {trend ? (
          <div className="ac-price-trend-arrow flex shrink-0 items-center pb-0.5" title={trendTitle} aria-hidden="true">
            <TrendArrow direction={trend.direction} className={dense ? "h-5 w-7 sm:h-6 sm:w-8" : "h-6 w-8 md:h-7 md:w-10"} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
