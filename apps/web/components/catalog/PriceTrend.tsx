"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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
  calculationSnapshot?: { currencyRate?: CurrencyRateLike } | null;
};

type LiveRate = Required<Pick<CurrencyRateLike, "currency" | "effectiveRate">> & CurrencyRateLike;
export type PriceTrendDirection = "up" | "down";
export type PriceTrendValue = { direction: PriceTrendDirection; deltaRub: number; formattedDelta: string };

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

function money(value: number) { return new Intl.NumberFormat("ru-RU").format(Math.round(value)); }
function finiteNumber(value: unknown) { const number = Number(value); return Number.isFinite(number) ? number : 0; }
function savedPriceDelta(offer: PriceLike) { const current = Number(offer.totalRub || 0); const explicitDelta = Number(offer.priceDeltaRub || 0); const previous = Number(offer.previousTotalRub || 0); return explicitDelta || (current && previous ? current - previous : 0); }

function currencyDelta(offer: PriceLike) {
  const current = Number(offer.totalRub || 0);
  const sourcePrice = Number(offer.sourcePrice || 0);
  const rate = offer.calculationSnapshot?.currencyRate;
  const effectiveRate = Number(rate?.effectiveRate || 0);
  const previousEffectiveRate = Number(rate?.previousEffectiveRate || 0);
  const explicitRateDelta = finiteNumber(rate?.rateDelta);
  const rateDelta = Math.abs(explicitRateDelta) > 1e-9 ? explicitRateDelta : effectiveRate && previousEffectiveRate ? effectiveRate - previousEffectiveRate : 0;
  if (!Number.isFinite(rateDelta) || Math.abs(rateDelta) < 1e-9) return 0;
  const estimatedSourcePrice = sourcePrice || (current && effectiveRate ? current / effectiveRate : 0);
  return estimatedSourcePrice ? Math.round(estimatedSourcePrice * rateDelta) : 0;
}

function formatDelta(value: number) {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(absolute / 1_000_000)}M`;
  if (absolute >= 1_000) return `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(absolute / 1_000)}K`;
  return `${money(absolute)} ₽`;
}

function withLiveRate(offer: PriceLike, liveRate: LiveRate | null): PriceLike {
  if (!liveRate) return offer;
  const stored = offer.calculationSnapshot?.currencyRate || {};
  const liveEffective = Number(liveRate.effectiveRate || 0);
  const storedEffective = Number(stored.effectiveRate || 0);
  let previousEffectiveRate = Number(liveRate.previousEffectiveRate || 0) || Number(stored.previousEffectiveRate || 0);
  let rateDelta = finiteNumber(liveRate.rateDelta);
  if (Math.abs(rateDelta) < 1e-9 && liveEffective && storedEffective && Math.abs(liveEffective - storedEffective) > 1e-9) { previousEffectiveRate = storedEffective; rateDelta = liveEffective - storedEffective; }
  if (Math.abs(rateDelta) < 1e-9 && Math.abs(finiteNumber(stored.rateDelta)) > 1e-9) { rateDelta = finiteNumber(stored.rateDelta); previousEffectiveRate = Number(stored.previousEffectiveRate || 0) || previousEffectiveRate; }
  return {
    ...offer,
    calculationSnapshot: {
      ...(offer.calculationSnapshot || {}),
      currencyRate: { ...stored, ...liveRate, effectiveRate: liveEffective || storedEffective, previousEffectiveRate: previousEffectiveRate || undefined, rateDelta: Math.abs(rateDelta) > 1e-9 ? rateDelta : undefined },
    },
  };
}

export function resolvePriceTrend(offer: PriceLike): PriceTrendValue | null {
  const current = Number(offer.totalRub || 0);
  const delta = savedPriceDelta(offer) || currencyDelta(offer);
  if (!current || !Number.isFinite(delta) || Math.abs(delta) < 1) return null;
  return { direction: delta < 0 ? "down" : "up", deltaRub: delta, formattedDelta: formatDelta(delta) };
}

function TrendArrow({ direction, className = "" }: { direction: PriceTrendDirection; className?: string }) {
  const down = direction === "down";
  return <svg className={className} width="38" height="29" viewBox="0 0 38 29" fill="none" aria-hidden="true">
    <path d={down ? "M3 5L11.5 13.5L18 9L34 25" : "M3 25L11.5 16.5L18 21L34 5"} stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    <path d={down ? "M25 25H34V16" : "M25 5H34V14"} stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

function formatRate(value: number, currency: string) {
  const maximumFractionDigits = ["JPY", "KRW"].includes(currency) ? 5 : value < 1 ? 5 : 4;
  return new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits }).format(value);
}

function rateDate(value: string | undefined) {
  if (!value) return "";
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("ru-RU");
}

function TrendPopover({ offer, trend, currency, panel }: { offer: PriceLike; trend: PriceTrendValue; currency: string; panel: boolean }) {
  const rate = offer.calculationSnapshot?.currencyRate;
  const currentRate = Number(rate?.effectiveRate || 0);
  const previousRate = Number(rate?.previousEffectiveRate || 0);
  const rateDelta = finiteNumber(rate?.rateDelta) || (currentRate && previousRate ? currentRate - previousRate : 0);
  const percent = previousRate ? rateDelta / previousRate * 100 : 0;
  const currencyDriven = Boolean(currentRate && previousRate && Math.abs(rateDelta) > 1e-9);
  const placementClass = panel
    ? "bottom-[calc(100%+10px)] xl:bottom-auto xl:top-[calc(100%+12px)]"
    : "bottom-[calc(100%+10px)]";
  const tailClass = panel
    ? "absolute -bottom-1.5 right-3 h-3 w-3 rotate-45 border-b border-r border-white/10 bg-[#11141c] xl:-top-1.5 xl:bottom-auto xl:border-b-0 xl:border-r-0 xl:border-l xl:border-t"
    : "absolute -bottom-1.5 right-3 h-3 w-3 rotate-45 border-b border-r border-white/10 bg-[#11141c]";

  return <div
    className={`ac-price-trend-popover absolute right-0 z-[400] w-[min(290px,78vw)] rounded-2xl border border-white/10 bg-[#11141c] p-3.5 text-left shadow-[0_20px_65px_rgba(0,0,0,.55)] xl:w-[310px] ${placementClass}`}
    style={{ color: "#ffffff" }}
    role="tooltip"
    onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
  >
    <div className="text-[10px] font-black uppercase tracking-[0.15em]" style={{ color: "rgba(255,255,255,.56)" }}>Почему изменилась цена</div>
    <div className="mt-1.5 text-sm font-black leading-5">{currencyDriven ? "Пересчитали по актуальному курсу валюты" : "Сравнили с предыдущим расчётом"}</div>
    {currencyDriven ? <div className="mt-3 grid gap-2 text-xs font-bold">
      <div className="flex items-center justify-between gap-3"><span style={{ color: "rgba(255,255,255,.66)" }}>Курс {currency}</span><span className="whitespace-nowrap">{formatRate(previousRate, currency)} ₽ → {formatRate(currentRate, currency)} ₽</span></div>
      <div className="flex items-center justify-between gap-3"><span style={{ color: "rgba(255,255,255,.66)" }}>Изменение курса</span><span className={rateDelta < 0 ? "text-[#31b765]" : "text-[#ff5c63]"}>{rateDelta < 0 ? "−" : "+"}{formatRate(Math.abs(rateDelta), currency)} ₽ ({percent < 0 ? "−" : "+"}{Math.abs(percent).toFixed(2)}%)</span></div>
      {(rate?.previousRateDate || rate?.rateDate) ? <div className="flex items-center justify-between gap-3"><span style={{ color: "rgba(255,255,255,.66)" }}>Период</span><span className="whitespace-nowrap">{rateDate(rate.previousRateDate)} → {rateDate(rate.rateDate)}</span></div> : null}
    </div> : null}
    <div className="mt-3 border-t border-white/10 pt-2.5 text-xs font-bold"><span style={{ color: "rgba(255,255,255,.66)" }}>Влияние на ориентир: </span><span className={trend.direction === "down" ? "text-[#31b765]" : "text-[#ff5c63]"}>{trend.direction === "down" ? "−" : "+"}{money(Math.abs(trend.deltaRub))} ₽</span></div>
    <div className="mt-2 text-[10px] leading-4" style={{ color: "rgba(255,255,255,.48)" }}>Итоговая цена подтверждается менеджером на момент оплаты.</div>
    <span className={tailClass} />
  </div>;
}

export function PriceTrend({ offer, label = "Ориентир", priceClassName = "text-[22px]", className = "", panel = false, dense = false }: { offer: PriceLike; label?: string; priceClassName?: string; className?: string; panel?: boolean; dense?: boolean }) {
  const currency = String(offer.sourceCurrency || offer.calculationSnapshot?.currencyRate?.currency || "").toUpperCase();
  const [liveRate, setLiveRate] = useState<LiveRate | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const trendRoot = useRef<HTMLSpanElement>(null);
  const touchToggle = useRef(false);

  useEffect(() => {
    if (!currency || currency === "RUB") return;
    let active = true;
    void loadLiveRates().then((rates) => { if (active) setLiveRate(rates[currency] || null); });
    return () => { active = false; };
  }, [currency]);

  useEffect(() => {
    if (!popoverOpen) return;
    const close = (event: PointerEvent) => { if (!trendRoot.current?.contains(event.target as Node)) setPopoverOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setPopoverOpen(false); };
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); window.removeEventListener("keydown", escape); };
  }, [popoverOpen]);

  const pricedOffer = useMemo(() => withLiveRate(offer, liveRate), [offer, liveRate]);
  const trend = resolvePriceTrend(pricedOffer);
  const direction = trend?.direction;
  const stateClass = direction === "down" ? "is-down" : direction === "up" ? "is-up" : "is-flat";
  const priceStateClass = direction === "down" ? "ac-price--down" : direction === "up" ? "ac-price--up" : "ac-price--flat";
  const hasPrice = Boolean(pricedOffer.totalRub);
  const trendUsesCurrency = Boolean(trend) && !savedPriceDelta(pricedOffer) && Boolean(currencyDelta(pricedOffer));
  const trendTitle = trend ? trendUsesCurrency ? "Цена изменилась из-за обновления курса. Нажмите, чтобы увидеть расчёт" : "Изменение относительно предыдущего сохранённого расчёта" : "Ожидается следующий снимок валютного курса";

  return <div className={`${panel ? "ac-price-trend-panel rounded-[1.35rem] p-4 shadow-[0_14px_38px_rgba(0,0,0,.14)]" : ""} ${stateClass} ${className}`}>
    <div className="flex min-w-0 items-center justify-between gap-2">
      <div className={`${dense ? "text-[8px] sm:text-[10px]" : panel ? "text-[10px] md:text-[11px]" : "text-[10px]"} ac-price-trend-label min-w-0 font-black uppercase tracking-[0.19em] text-[var(--ac-text)]`}>{label}</div>
      {trend ? <span className={`${dense ? "text-[9px] sm:text-xs" : "text-xs md:text-sm"} ac-price-trend-delta shrink-0 font-black leading-none`} title={trendTitle}>{trend.direction === "down" ? "−" : "+"}{trend.formattedDelta}</span> : null}
    </div>
    <div className={`${dense ? "mt-1 gap-1 sm:mt-1.5 sm:gap-3" : "mt-1.5 gap-3"} flex min-w-0 items-end justify-between`}>
      <div className={`ac-price ${priceStateClass} min-w-0 font-black leading-none tracking-[-0.05em] ${hasPrice ? "whitespace-nowrap" : "break-words"} ${priceClassName}`}>
        {hasPrice ? <><span>{money(Number(pricedOffer.totalRub))}</span><span className="ml-[0.18em] inline-block translate-y-[-0.03em] text-[0.58em] tracking-[-0.02em]">₽</span></> : "Цена по запросу"}
      </div>
      {trend ? <span
        ref={trendRoot}
        role="button"
        tabIndex={0}
        aria-label={`${trend.direction === "down" ? "Цена снизилась" : "Цена выросла"} на ${trend.formattedDelta}. Показать влияние курса валюты`}
        aria-expanded={popoverOpen}
        className="ac-price-trend-arrow relative flex shrink-0 cursor-pointer items-center rounded-lg pb-0.5 outline-none transition hover:scale-105 focus-visible:ring-2 focus-visible:ring-current/50"
        onMouseEnter={() => setPopoverOpen(true)}
        onMouseLeave={() => setPopoverOpen(false)}
        onPointerDown={(event) => {
          if (event.pointerType === "mouse") return;
          event.preventDefault();
          event.stopPropagation();
          touchToggle.current = true;
          setPopoverOpen((current) => !current);
          window.setTimeout(() => { touchToggle.current = false; }, 450);
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (touchToggle.current) return;
          setPopoverOpen((current) => !current);
        }}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); setPopoverOpen((current) => !current); } }}
      >
        <TrendArrow direction={trend.direction} className={dense ? "h-5 w-7 sm:h-6 sm:w-8" : "h-6 w-8 md:h-7 md:w-10"} />
        {popoverOpen ? <TrendPopover offer={pricedOffer} trend={trend} currency={currency || "валюты"} panel={panel} /> : null}
      </span> : null}
    </div>
  </div>;
}
