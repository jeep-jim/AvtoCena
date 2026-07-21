"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type RateHistoryPoint = {
  date: string;
  effectiveRate: number;
};

export type PublicCurrencyRate = {
  currency: string;
  effectiveRate: number;
  previousEffectiveRate?: number;
  rateDelta?: number;
  rateDate?: string;
  previousRateDate?: string;
  history?: RateHistoryPoint[];
};

type CurrencyRateLike = Partial<PublicCurrencyRate>;

type PriceLike = {
  totalRub?: number | null;
  previousTotalRub?: number | null;
  priceDeltaRub?: number | null;
  priceChangedAt?: string;
  sourcePrice?: number | null;
  sourceCurrency?: string | null;
  calculationSnapshot?: { currencyRate?: CurrencyRateLike } | null;
};

type LiveRate = Required<Pick<PublicCurrencyRate, "currency" | "effectiveRate">> & PublicCurrencyRate;
export type PriceTrendDirection = "up" | "down";
export type PriceTrendValue = { direction: PriceTrendDirection; deltaRub: number; formattedDelta: string };

const RATE_ORDER = ["JPY", "CNY", "KRW", "AED", "EUR", "USD"];
const RATE_META: Record<string, { flag: string; label: string; nominal: number }> = {
  JPY: { flag: "🇯🇵", label: "Японская иена", nominal: 100 },
  CNY: { flag: "🇨🇳", label: "Китайский юань", nominal: 1 },
  KRW: { flag: "🇰🇷", label: "Корейская вона", nominal: 1000 },
  AED: { flag: "🇦🇪", label: "Дирхам ОАЭ", nominal: 1 },
  EUR: { flag: "🇪🇺", label: "Евро", nominal: 1 },
  USD: { flag: "🇺🇸", label: "Доллар США", nominal: 1 },
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
  return { direction: delta < 0 ? "down" : "up", deltaRub: delta, formattedDelta: formatDelta(delta) };
}

function TrendArrow({ direction, className = "" }: { direction: PriceTrendDirection; className?: string }) {
  const down = direction === "down";
  return <svg className={className} width="38" height="29" viewBox="0 0 38 29" fill="none" aria-hidden="true">
    <path d={down ? "M3 5L11.5 13.5L18 9L34 25" : "M3 25L11.5 16.5L18 21L34 5"} stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    <path d={down ? "M25 25H34V16" : "M25 5H34V14"} stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

function formatRate(value: number, currency: string, nominal = 1) {
  const displayed = value * nominal;
  const maximumFractionDigits = nominal > 1 ? 2 : ["JPY", "KRW"].includes(currency) ? 5 : displayed < 1 ? 5 : 4;
  return new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits }).format(displayed);
}

function fullRateDate(value: string | undefined) {
  if (!value) return "";
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("ru-RU");
}

function shortRateDate(value: string | undefined) {
  if (!value) return "";
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value.slice(5) : parsed.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

function normalizedHistory(rate: CurrencyRateLike | undefined) {
  const history = Array.isArray(rate?.history)
    ? rate.history
      .map((point) => ({ date: String(point?.date || "").slice(0, 10), effectiveRate: Number(point?.effectiveRate || 0) }))
      .filter((point) => point.date && point.effectiveRate > 0)
    : [];
  const unique = new Map(history.map((point) => [point.date, point.effectiveRate]));
  const currentDate = String(rate?.rateDate || "").slice(0, 10);
  const previousDate = String(rate?.previousRateDate || "").slice(0, 10);
  const current = Number(rate?.effectiveRate || 0);
  const previous = Number(rate?.previousEffectiveRate || 0);
  if (previousDate && previous > 0) unique.set(previousDate, previous);
  if (currentDate && current > 0) unique.set(currentDate, current);
  const points = [...unique].map(([date, effectiveRate]) => ({ date, effectiveRate })).sort((left, right) => left.date.localeCompare(right.date)).slice(-5);
  if (points.length === 1) {
    const fallbackDate = previousDate || points[0].date;
    points.unshift({ date: fallbackDate, effectiveRate: previous || points[0].effectiveRate });
  }
  return points;
}

function RateSparkline({ rate, light = false }: { rate: CurrencyRateLike; light?: boolean }) {
  const currency = String(rate.currency || "").toUpperCase();
  const meta = RATE_META[currency] || { flag: "💱", label: currency || "Валюта", nominal: 1 };
  const points = normalizedHistory(rate);
  const values = points.map((point) => point.effectiveRate * meta.nominal);
  const width = 360;
  const height = 132;
  const paddingX = 12;
  const paddingY = 15;
  const minimum = values.length ? Math.min(...values) : 0;
  const maximum = values.length ? Math.max(...values) : 1;
  const spread = Math.max(maximum - minimum, Math.abs(maximum) * 0.003, 0.00001);
  const coords = values.map((value, index) => {
    const x = paddingX + (index / Math.max(1, values.length - 1)) * (width - paddingX * 2);
    const y = paddingY + ((maximum - value) / spread) * (height - paddingY * 2);
    return { x, y };
  });
  const line = coords.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const area = coords.length ? `${line} L${coords[coords.length - 1].x.toFixed(1)} ${height - paddingY} L${coords[0].x.toFixed(1)} ${height - paddingY} Z` : "";
  const first = values[0] || 0;
  const last = values[values.length - 1] || Number(rate.effectiveRate || 0) * meta.nominal;
  const rising = last > first;
  const color = rising ? "#ff4b55" : "#31b765";

  return <div className={`overflow-hidden rounded-2xl border p-3 ${light ? "border-[#dfe3ea] bg-[#f1f3f7]" : "border-white/10 bg-white/[0.035]"}`}>
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className={`text-[10px] font-black uppercase tracking-[0.15em] ${light ? "text-[#7a8291]" : "text-white/45"}`}>Курс за 5 дней</div>
        <div className={`mt-1 text-sm font-black ${light ? "text-[#151922]" : "text-white"}`}>{meta.nominal > 1 ? `${meta.nominal} ${currency}` : currency} = {formatRate(Number(rate.effectiveRate || 0), currency, meta.nominal)} ₽</div>
      </div>
      <div className="text-xl" aria-hidden="true">{meta.flag}</div>
    </div>
    <svg className="mt-2 block h-[112px] w-full overflow-visible" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-label={`Изменение курса ${currency} за пять дней`}>
      {[0.25, 0.5, 0.75].map((part) => <line key={part} x1={paddingX} x2={width - paddingX} y1={height * part} y2={height * part} stroke={light ? "rgba(28,34,45,.09)" : "rgba(255,255,255,.08)"} strokeWidth="1" strokeDasharray="4 5" />)}
      {area ? <path d={area} fill={color} opacity="0.1" /> : null}
      {line ? <path d={line} fill="none" stroke={color} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /> : null}
      {coords.map((point, index) => <circle key={`${point.x}-${point.y}`} cx={point.x} cy={point.y} r={index === coords.length - 1 ? 4.5 : 3} fill={color} stroke={light ? "#f1f3f7" : "#151821"} strokeWidth="2" vectorEffect="non-scaling-stroke" />)}
    </svg>
    <div className={`mt-1 flex items-center justify-between text-[10px] font-bold ${light ? "text-[#7b8493]" : "text-white/42"}`}>
      <span>{shortRateDate(points[0]?.date)}</span>
      <span>{shortRateDate(points[points.length - 1]?.date)}</span>
    </div>
  </div>;
}

function CurrencyRateDetails({ rate, impactRub, light = false, compact = false }: { rate: CurrencyRateLike; impactRub?: number; light?: boolean; compact?: boolean }) {
  const currency = String(rate.currency || "").toUpperCase();
  const history = normalizedHistory(rate);
  const currentRate = Number(rate.effectiveRate || 0);
  const fallbackPrevious = history.length > 1 ? history[history.length - 2].effectiveRate : 0;
  const previousRate = Number(rate.previousEffectiveRate || fallbackPrevious || 0);
  const rateDelta = finiteNumber(rate.rateDelta) || (currentRate && previousRate ? currentRate - previousRate : 0);
  const percent = previousRate ? rateDelta / previousRate * 100 : 0;
  const deltaClass = rateDelta < 0 ? "text-[#20a85e]" : rateDelta > 0 ? "text-[#ef3340]" : light ? "text-[#4f5868]" : "text-white/60";
  const muted = light ? "text-[#6b7483]" : "text-white/58";
  const strong = light ? "text-[#141821]" : "text-white";

  return <div>
    <RateSparkline rate={rate} light={light} />
    <div className={`mt-4 flex items-start gap-2.5 ${strong}`}>
      <span className="ac-pulse-dot ac-pulse-dot--status mt-1 shrink-0" aria-hidden="true"><span /></span>
      <div className={`${compact ? "text-sm leading-5" : "text-base leading-6"} font-black`}>Пересчитали по актуальному курсу валюты</div>
    </div>
    <div className={`${compact ? "mt-3 gap-2 text-xs" : "mt-4 gap-3 text-sm"} grid font-bold`}>
      <div className="flex items-center justify-between gap-4"><span className={muted}>Курс {currency}</span><span className={`whitespace-nowrap ${strong}`}>{previousRate ? `${formatRate(previousRate, currency)} ₽ → ` : ""}{formatRate(currentRate, currency)} ₽</span></div>
      <div className="flex items-center justify-between gap-4"><span className={muted}>Изменение курса</span><span className={`whitespace-nowrap ${deltaClass}`}>{rateDelta < 0 ? "−" : rateDelta > 0 ? "+" : ""}{formatRate(Math.abs(rateDelta), currency)} ₽ ({percent < 0 ? "−" : percent > 0 ? "+" : ""}{Math.abs(percent).toFixed(2)}%)</span></div>
      {(rate.previousRateDate || rate.rateDate || history.length) ? <div className="flex items-center justify-between gap-4"><span className={muted}>Период</span><span className={`whitespace-nowrap ${strong}`}>{fullRateDate(history[0]?.date || rate.previousRateDate)} → {fullRateDate(history[history.length - 1]?.date || rate.rateDate)}</span></div> : null}
    </div>
    {impactRub ? <div className={`mt-4 border-t pt-3 text-sm font-bold ${light ? "border-[#dde1e8]" : "border-white/10"}`}><span className={muted}>Влияние на ориентир: </span><span className={impactRub < 0 ? "text-[#20a85e]" : "text-[#ef3340]"}>{impactRub < 0 ? "−" : "+"}{money(Math.abs(impactRub))} ₽</span></div> : null}
    <div className={`mt-3 text-[11px] leading-4 ${light ? "text-[#7a8290]" : "text-white/42"}`}>Итоговая цена подтверждается менеджером на момент оплаты.</div>
  </div>;
}

export function CurrencyRatesSheet({ open, onClose, rates, initialCurrency, impactRub }: { open: boolean; onClose: () => void; rates: PublicCurrencyRate[]; initialCurrency?: string; impactRub?: number }) {
  const orderedRates = useMemo(() => [...rates]
    .filter((rate) => rate?.currency && Number(rate?.effectiveRate) > 0)
    .sort((left, right) => {
      const leftIndex = RATE_ORDER.indexOf(String(left.currency).toUpperCase());
      const rightIndex = RATE_ORDER.indexOf(String(right.currency).toUpperCase());
      return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex);
    }), [rates]);
  const [activeCurrency, setActiveCurrency] = useState("");
  const rateKey = orderedRates.map((rate) => String(rate.currency).toUpperCase()).join("|");

  useEffect(() => {
    if (!open) return;
    const requested = String(initialCurrency || "").toUpperCase();
    setActiveCurrency(orderedRates.some((rate) => String(rate.currency).toUpperCase() === requested) ? requested : String(orderedRates[0]?.currency || "").toUpperCase());
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", escape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", escape);
    };
  }, [open, initialCurrency, rateKey]);

  if (!open || typeof document === "undefined") return null;
  const activeRate = orderedRates.find((rate) => String(rate.currency).toUpperCase() === activeCurrency) || orderedRates[0];
  if (!activeRate) return null;

  return createPortal(
    <div className="fixed inset-0 z-[14000] flex items-end justify-center bg-black/75 md:items-center md:p-6" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}>
      <section className="ac-rate-sheet ac-hide-scrollbar relative max-h-[92dvh] w-full overflow-y-auto rounded-t-[30px] bg-[#f8f9fb] text-[#151922] shadow-[0_-24px_80px_rgba(0,0,0,.38)] md:max-w-[570px] md:rounded-[30px]" role="dialog" aria-modal="true" aria-label="Курсы валют" onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}>
        <div className="sticky top-0 z-10 border-b border-[#dfe3e9] bg-[#f8f9fb]/95 px-5 pb-4 pt-3 backdrop-blur-xl md:rounded-t-[30px]">
          <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-[#cfd4dc] md:hidden" />
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.16em] text-[#ef3340]">АвтоЦена</div>
              <h2 className="mt-1 text-xl font-black">{orderedRates.length > 1 ? "Курсы валют" : `Курс ${String(activeRate.currency).toUpperCase()}`}</h2>
            </div>
            <button type="button" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full bg-[#edf0f4] text-2xl font-medium text-[#202630]" aria-label="Закрыть">×</button>
          </div>
          {orderedRates.length > 1 ? <div className="ac-hide-scrollbar -mx-1 mt-4 flex gap-2 overflow-x-auto px-1 pb-1">
            {orderedRates.map((rate) => {
              const currency = String(rate.currency).toUpperCase();
              const active = currency === String(activeRate.currency).toUpperCase();
              const delta = finiteNumber(rate.rateDelta) || (Number(rate.effectiveRate || 0) - Number(rate.previousEffectiveRate || 0));
              return <button key={currency} type="button" onClick={() => setActiveCurrency(currency)} className={`min-w-[88px] rounded-2xl border px-3 py-2.5 text-left transition ${active ? "border-[#ef3340] bg-[#fff0f1]" : "border-[#dde2e9] bg-[#f0f2f6]"}`}>
                <div className="flex items-center justify-between gap-2"><span className="text-lg">{RATE_META[currency]?.flag || "💱"}</span><span className={`text-[10px] font-black ${delta < 0 ? "text-[#20a85e]" : delta > 0 ? "text-[#ef3340]" : "text-[#788190]"}`}>{delta < 0 ? "↓" : delta > 0 ? "↑" : "—"}</span></div>
                <div className="mt-1 text-xs font-black">{currency}</div>
              </button>;
            })}
          </div> : null}
        </div>
        <div className="px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-5">
          <CurrencyRateDetails rate={activeRate} impactRub={impactRub} light />
        </div>
      </section>
    </div>,
    document.body,
  );
}

function TrendPopover({ offer, trend, currency, panel }: { offer: PriceLike; trend: PriceTrendValue; currency: string; panel: boolean }) {
  const rate = { currency, ...(offer.calculationSnapshot?.currencyRate || {}) };
  const placementClass = panel ? "top-[calc(100%+12px)]" : "bottom-[calc(100%+10px)]";
  const widthClass = panel ? "w-[min(430px,calc(100vw-48px))]" : "w-[min(360px,82vw)]";
  const tailClass = panel
    ? "absolute -top-1.5 right-3 h-3 w-3 rotate-45 border-l border-t border-white/10 bg-[#11141c]"
    : "absolute -bottom-1.5 right-3 h-3 w-3 rotate-45 border-b border-r border-white/10 bg-[#11141c]";

  return <div
    className={`ac-price-trend-popover absolute right-0 z-[400] hidden ${widthClass} rounded-2xl border border-white/10 bg-[#11141c] p-3.5 text-left shadow-[0_20px_65px_rgba(0,0,0,.55)] md:block ${placementClass}`}
    style={{ color: "#ffffff" }}
    role="tooltip"
    onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
  >
    <div className="mb-3 text-[10px] font-black uppercase tracking-[0.15em] text-white/48">Почему изменилась цена</div>
    <CurrencyRateDetails rate={rate} impactRub={trend.deltaRub} compact />
    <span className={tailClass} />
  </div>;
}

export function PriceTrend({ offer, label = "Ориентир", priceClassName = "text-[22px]", className = "", panel = false, dense = false }: { offer: PriceLike; label?: string; priceClassName?: string; className?: string; panel?: boolean; dense?: boolean }) {
  const currency = String(offer.sourceCurrency || offer.calculationSnapshot?.currencyRate?.currency || "").toUpperCase();
  const [liveRate, setLiveRate] = useState<LiveRate | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const trendRoot = useRef<HTMLSpanElement>(null);

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
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [popoverOpen]);

  const pricedOffer = useMemo(() => withLiveRate(offer, liveRate), [offer, liveRate]);
  const trend = resolvePriceTrend(pricedOffer);
  const direction = trend?.direction;
  const stateClass = direction === "down" ? "is-down" : direction === "up" ? "is-up" : "is-flat";
  const priceStateClass = direction === "down" ? "ac-price--down" : direction === "up" ? "ac-price--up" : "ac-price--flat";
  const hasPrice = Boolean(pricedOffer.totalRub);
  const trendUsesCurrency = Boolean(trend) && !savedPriceDelta(pricedOffer) && Boolean(currencyDelta(pricedOffer));
  const trendTitle = trend ? trendUsesCurrency ? "Цена изменилась из-за обновления курса. Нажмите, чтобы увидеть расчёт" : "Изменение относительно предыдущего сохранённого расчёта" : "Ожидается следующий снимок валютного курса";
  const sheetRate: PublicCurrencyRate | null = currency && pricedOffer.calculationSnapshot?.currencyRate?.effectiveRate
    ? { currency, ...(pricedOffer.calculationSnapshot.currencyRate as PublicCurrencyRate) }
    : liveRate;

  return <div className={`relative ${panel ? "ac-price-trend-panel rounded-[1.35rem] p-4 shadow-[0_14px_38px_rgba(0,0,0,.14)]" : ""} ${stateClass} ${className}`}>
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
        aria-expanded={popoverOpen || sheetOpen}
        className="ac-price-trend-arrow relative flex shrink-0 cursor-pointer items-center rounded-lg pb-0.5 outline-none transition hover:scale-105 focus-visible:ring-2 focus-visible:ring-current/50"
        onMouseEnter={() => setPopoverOpen(true)}
        onMouseLeave={() => setPopoverOpen(false)}
        onPointerDown={(event) => {
          if (event.pointerType === "mouse") return;
          event.preventDefault();
          event.stopPropagation();
          setPopoverOpen(false);
          setSheetOpen(true);
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (window.matchMedia("(max-width: 767px)").matches) {
            setSheetOpen(true);
            setPopoverOpen(false);
          } else {
            setPopoverOpen(true);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            if (window.matchMedia("(max-width: 767px)").matches) setSheetOpen(true);
            else setPopoverOpen((current) => !current);
          }
        }}
      >
        <TrendArrow direction={trend.direction} className={dense ? "h-5 w-7 sm:h-6 sm:w-8" : "h-6 w-8 md:h-7 md:w-10"} />
        {popoverOpen ? <TrendPopover offer={pricedOffer} trend={trend} currency={currency || "валюты"} panel={panel} /> : null}
      </span> : null}
    </div>
    {sheetRate && trend ? <CurrencyRatesSheet open={sheetOpen} onClose={() => setSheetOpen(false)} rates={[sheetRate]} initialCurrency={currency} impactRub={trend.deltaRub} /> : null}
  </div>;
}
