"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { createPortal } from "react-dom";

export type RateHistoryPoint = { date: string; effectiveRate: number };
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
type ChartPoint = RateHistoryPoint & { actual: boolean };
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

const RATE_ORDER = ["JPY", "CNY", "KRW", "AED", "EUR", "GEL", "USD", "GBP", "PLN", "CHF", "SEK", "NOK", "DKK", "HUF", "CZK"];
const RATE_META: Record<string, { flag: string; label: string; nominal: number; country: string }> = {
  JPY: { flag: "🇯🇵", label: "Японская иена", nominal: 100, country: "Япония" },
  CNY: { flag: "🇨🇳", label: "Китайский юань", nominal: 1, country: "Китай" },
  KRW: { flag: "🇰🇷", label: "Корейская вона", nominal: 1000, country: "Южная Корея" },
  AED: { flag: "🇦🇪", label: "Дирхам ОАЭ", nominal: 1, country: "ОАЭ" },
  EUR: { flag: "🇪🇺", label: "Евро", nominal: 1, country: "Европа" },
  GEL: { flag: "🇬🇪", label: "Грузинский лари", nominal: 1, country: "Грузия" },
  USD: { flag: "🇺🇸", label: "Доллар США", nominal: 1, country: "США" },
  GBP: { flag: "🇬🇧", label: "Фунт стерлингов", nominal: 1, country: "Великобритания" },
  PLN: { flag: "🇵🇱", label: "Польский злотый", nominal: 1, country: "Польша" },
  CHF: { flag: "🇨🇭", label: "Швейцарский франк", nominal: 1, country: "Швейцария" },
  SEK: { flag: "🇸🇪", label: "Шведская крона", nominal: 1, country: "Швеция" },
  NOK: { flag: "🇳🇴", label: "Норвежская крона", nominal: 1, country: "Норвегия" },
  DKK: { flag: "🇩🇰", label: "Датская крона", nominal: 1, country: "Дания" },
  HUF: { flag: "🇭🇺", label: "Венгерский форинт", nominal: 1, country: "Венгрия" },
  CZK: { flag: "🇨🇿", label: "Чешская крона", nominal: 1, country: "Чехия" },
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

function DirectionArrowSvg({ direction, className = "" }: { direction: PriceTrendDirection; className?: string }) {
  const down = direction === "down";
  return <svg className={className} width="38" height="29" viewBox="0 0 38 29" fill="none" aria-hidden="true">
    <path d={down ? "M3 5L11.5 13.5L18 9L34 25" : "M3 25L11.5 16.5L18 21L34 5"} stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    <path d={down ? "M25 25H34V16" : "M25 5H34V14"} stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

function TrendArrow({ direction, className = "" }: { direction: PriceTrendDirection; className?: string }) {
  return <DirectionArrowSvg direction={direction} className={className} />;
}

export function RateDirectionIcon({ direction, className = "" }: { direction: PriceTrendDirection; className?: string }) {
  return <DirectionArrowSvg direction={direction} className={className} />;
}

export function CurrencyFlag({ currency, className = "h-4 w-6" }: { currency: string; className?: string }) {
  const code = String(currency || "").toUpperCase();
  const common = `block shrink-0 overflow-hidden rounded-[4px] border border-black/10 shadow-[0_1px_2px_rgba(0,0,0,.12)] ${className}`;
  if (code === "JPY") return <svg viewBox="0 0 28 20" className={common} role="img" aria-label="Флаг Японии"><rect width="28" height="20" fill="#fff" /><circle cx="14" cy="10" r="5" fill="#bc002d" /></svg>;
  if (code === "CNY") return <svg viewBox="0 0 28 20" className={common} role="img" aria-label="Флаг Китая"><rect width="28" height="20" fill="#de2910" /><polygon points="6,3 7.1,5.4 9.8,5.6 7.7,7.3 8.4,10 6,8.5 3.6,10 4.3,7.3 2.2,5.6 4.9,5.4" fill="#ffde00" /><circle cx="12" cy="4" r=".8" fill="#ffde00" /><circle cx="14" cy="7" r=".8" fill="#ffde00" /><circle cx="13" cy="11" r=".8" fill="#ffde00" /></svg>;
  if (code === "KRW") return <svg viewBox="0 0 28 20" className={common} role="img" aria-label="Флаг Южной Кореи"><rect width="28" height="20" fill="#fff" /><circle cx="14" cy="10" r="4.2" fill="#cd2e3a" /><path d="M9.8 10a4.2 4.2 0 0 0 8.4 0c-2.1-1.9-4.2 1.9-6.3 0-1.05-.95-1.4-.95-2.1 0Z" fill="#0047a0" /><g stroke="#111" strokeWidth="1"><path d="M4 4l4 2M4 6l4 2M20 12l4 2M20 14l4 2" /><path d="M20 4l4 2M21 3l1 1M23 7l1 1M4 14l4 2M5 13l1 1M7 17l1 1" /></g></svg>;
  if (code === "AED") return <svg viewBox="0 0 28 20" className={common} role="img" aria-label="Флаг ОАЭ"><rect width="28" height="20" fill="#fff" /><rect x="0" y="0" width="28" height="6.67" fill="#00732f" /><rect x="0" y="13.33" width="28" height="6.67" fill="#000" /><rect width="7" height="20" fill="#ff0000" /></svg>;
  if (code === "EUR") return <svg viewBox="0 0 28 20" className={common} role="img" aria-label="Флаг Европейского союза"><rect width="28" height="20" fill="#003399" />{Array.from({ length: 12 }, (_, index) => { const angle = index * Math.PI / 6 - Math.PI / 2; return <circle key={index} cx={14 + Math.cos(angle) * 5.2} cy={10 + Math.sin(angle) * 5.2} r=".7" fill="#ffcc00" />; })}</svg>;
  if (code === "GEL") return <svg viewBox="0 0 28 20" className={common} role="img" aria-label="Флаг Грузии"><rect width="28" height="20" fill="#fff" /><rect x="12" width="4" height="20" fill="#ff0000" /><rect y="8" width="28" height="4" fill="#ff0000" /><g fill="#ff0000"><path d="M5 3h1v2h2v1H6v2H5V6H3V5h2Z" /><path d="M22 3h1v2h2v1h-2v2h-1V6h-2V5h2Z" /><path d="M5 12h1v2h2v1H6v2H5v-2H3v-1h2Z" /><path d="M22 12h1v2h2v1h-2v2h-1v-2h-2v-1h2Z" /></g></svg>;
  if (code === "USD") return <svg viewBox="0 0 28 20" className={common} role="img" aria-label="Флаг США"><rect width="28" height="20" fill="#fff" />{Array.from({ length: 7 }, (_, index) => <rect key={index} y={index * 3} width="28" height="1.55" fill="#b22234" />)}<rect width="12" height="9" fill="#3c3b6e" /><g fill="#fff">{Array.from({ length: 12 }, (_, index) => <circle key={index} cx={1.5 + (index % 4) * 3} cy={1.5 + Math.floor(index / 4) * 2.7} r=".45" />)}</g></svg>;
  if (code === "GBP") return <svg viewBox="0 0 28 20" className={common} role="img" aria-label="Флаг Великобритании"><rect width="28" height="20" fill="#012169" /><path d="M0 0L28 20M28 0L0 20" stroke="#fff" strokeWidth="5" /><path d="M0 0L28 20M28 0L0 20" stroke="#c8102e" strokeWidth="2" /><path d="M14 0V20M0 10H28" stroke="#fff" strokeWidth="6" /><path d="M14 0V20M0 10H28" stroke="#c8102e" strokeWidth="3" /></svg>;
  if (code === "PLN") return <svg viewBox="0 0 28 20" className={common} role="img" aria-label="Флаг Польши"><rect width="28" height="10" fill="#fff" /><rect y="10" width="28" height="10" fill="#dc143c" /></svg>;
  if (code === "CHF") return <svg viewBox="0 0 28 20" className={common} role="img" aria-label="Флаг Швейцарии"><rect width="28" height="20" fill="#d52b1e" /><path d="M11.5 4H16.5V7.5H20V12.5H16.5V16H11.5V12.5H8V7.5H11.5Z" fill="#fff" /></svg>;
  if (code === "SEK") return <svg viewBox="0 0 28 20" className={common} role="img" aria-label="Флаг Швеции"><rect width="28" height="20" fill="#006aa7" /><rect x="8" width="3" height="20" fill="#fecc00" /><rect y="8.5" width="28" height="3" fill="#fecc00" /></svg>;
  if (code === "NOK") return <svg viewBox="0 0 28 20" className={common} role="img" aria-label="Флаг Норвегии"><rect width="28" height="20" fill="#ba0c2f" /><rect x="8" width="5" height="20" fill="#fff" /><rect y="7.5" width="28" height="5" fill="#fff" /><rect x="9.5" width="2" height="20" fill="#00205b" /><rect y="9" width="28" height="2" fill="#00205b" /></svg>;
  if (code === "DKK") return <svg viewBox="0 0 28 20" className={common} role="img" aria-label="Флаг Дании"><rect width="28" height="20" fill="#c60c30" /><rect x="8" width="3" height="20" fill="#fff" /><rect y="8.5" width="28" height="3" fill="#fff" /></svg>;
  if (code === "HUF") return <svg viewBox="0 0 28 20" className={common} role="img" aria-label="Флаг Венгрии"><rect width="28" height="6.67" fill="#ce2939" /><rect y="6.67" width="28" height="6.66" fill="#fff" /><rect y="13.33" width="28" height="6.67" fill="#477050" /></svg>;
  if (code === "CZK") return <svg viewBox="0 0 28 20" className={common} role="img" aria-label="Флаг Чехии"><rect width="28" height="10" fill="#fff" /><rect y="10" width="28" height="10" fill="#d7141a" /><path d="M0 0L12 10L0 20Z" fill="#11457e" /></svg>;
  return <span className={`flex shrink-0 items-center justify-center rounded-[4px] bg-white/10 text-[8px] font-black ${className}`}>🌐</span>;
}

function formatRate(value: number, currency: string, nominal = 1) {
  const displayed = value * nominal;
  const maximumFractionDigits = nominal > 1 ? 3 : ["JPY", "KRW"].includes(currency) ? 5 : displayed < 1 ? 5 : 4;
  return new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits }).format(displayed);
}

function formatPointDelta(value: number) {
  const absolute = Math.abs(value);
  const maximumFractionDigits = absolute >= 10 ? 2 : absolute >= 1 ? 2 : absolute >= 0.01 ? 3 : 5;
  const formatted = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits }).format(absolute);
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatted}`;
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

function validIsoDate(value: unknown) {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function dateShift(value: string, offset: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function localCalendarDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizedHistory(rate: CurrencyRateLike | undefined): ChartPoint[] {
  const unique = new Map<string, number>();
  for (const point of Array.isArray(rate?.history) ? rate.history : []) {
    const date = validIsoDate(point?.date);
    const effectiveRate = Number(point?.effectiveRate || 0);
    if (date && effectiveRate > 0) unique.set(date, effectiveRate);
  }

  const currentDate = validIsoDate(rate?.rateDate);
  const previousDate = validIsoDate(rate?.previousRateDate);
  const current = Number(rate?.effectiveRate || 0);
  const previous = Number(rate?.previousEffectiveRate || 0);
  if (previousDate && previous > 0) unique.set(previousDate, previous);
  if (currentDate && current > 0) unique.set(currentDate, current);

  const actual = [...unique]
    .map(([date, effectiveRate]) => ({ date, effectiveRate, actual: true }))
    .sort((left, right) => left.date.localeCompare(right.date));
  if (!actual.length) return [];

  const endDate = localCalendarDate();
  const dates = Array.from({ length: 5 }, (_, index) => dateShift(endDate, index - 4));
  const fallback = current || previous || actual.at(-1)?.effectiveRate || 0;

  return dates.map((date) => {
    const exact = unique.get(date);
    if (exact) return { date, effectiveRate: exact, actual: true };
    const earlier = [...actual].reverse().find((point) => point.date <= date);
    const later = actual.find((point) => point.date >= date);
    return { date, effectiveRate: earlier?.effectiveRate || later?.effectiveRate || fallback, actual: false };
  }).filter((point) => point.effectiveRate > 0);
}

function pointMovementColor(delta: number, fallback: string, light: boolean) {
  if (delta < -1e-12) return "#20a85e";
  if (delta > 1e-12) return "#ef3340";
  return fallback || (light ? "#7c8594" : "rgba(255,255,255,.58)");
}

function RateSparkline({ rate, light = false }: { rate: CurrencyRateLike; light?: boolean }) {
  const currency = String(rate.currency || "").toUpperCase();
  const meta = RATE_META[currency] || { flag: "💱", label: currency || "Валюта", nominal: 1, country: currency || "Валюта" };
  const points = normalizedHistory(rate);
  const historyKey = points.map((point) => `${point.date}:${point.effectiveRate}`).join("|");
  const [selectedIndex, setSelectedIndex] = useState(Math.max(0, points.length - 1));

  useEffect(() => {
    setSelectedIndex(Math.max(0, points.length - 1));
  }, [currency, historyKey, points.length]);

  const values = points.map((point) => point.effectiveRate * meta.nominal);
  const width = 360;
  const height = 150;
  const paddingX = 16;
  const plotTop = 15;
  const plotBottom = 100;
  const minimum = values.length ? Math.min(...values) : 0;
  const maximum = values.length ? Math.max(...values) : 1;
  const rawSpread = Math.max(0, maximum - minimum);
  const fallbackSpread = Math.max(Math.abs(maximum) * 0.00002, 0.000001);
  const visualSpread = rawSpread > 0 ? rawSpread : fallbackSpread;
  const chartMinimum = minimum - visualSpread * 0.18;
  const chartMaximum = maximum + visualSpread * 0.18;
  const chartSpread = Math.max(chartMaximum - chartMinimum, fallbackSpread);
  const coords = values.map((value, index) => {
    const x = paddingX + (index / Math.max(1, values.length - 1)) * (width - paddingX * 2);
    const y = plotTop + ((chartMaximum - value) / chartSpread) * (plotBottom - plotTop);
    return { x, y };
  });
  const line = coords.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const area = coords.length ? `${line} L${coords.at(-1)!.x.toFixed(1)} ${plotBottom + 12} L${coords[0].x.toFixed(1)} ${plotBottom + 12} Z` : "";
  const first = values[0] || 0;
  const last = values.at(-1) || Number(rate.effectiveRate || 0) * meta.nominal;
  const recentNonZeroDelta = values.slice(1).map((value, index) => value - values[index]).reverse().find((value) => Math.abs(value) > 1e-12) || 0;
  const totalDelta = last - first;
  const directionDelta = Math.abs(totalDelta) > 1e-12 ? totalDelta : recentNonZeroDelta;
  const color = directionDelta > 0 ? "#ff4b55" : directionDelta < 0 ? "#31b765" : light ? "#7c8594" : "rgba(255,255,255,.58)";
  const pointStroke = light ? "#f1f3f7" : "#151821";
  const selectedPoint = points[selectedIndex] || points.at(-1);
  const selectedValue = values[selectedIndex] ?? values.at(-1) ?? Number(rate.effectiveRate || 0) * meta.nominal;
  const selectedDelta = selectedIndex > 0 ? selectedValue - values[selectedIndex - 1] : directionDelta;
  const selectedColor = pointMovementColor(selectedDelta, color, light);
  const selectedBackground = selectedDelta < -1e-12
    ? light ? "rgba(32,168,94,.10)" : "rgba(32,168,94,.16)"
    : selectedDelta > 1e-12
      ? light ? "rgba(239,51,64,.09)" : "rgba(239,51,64,.16)"
      : light ? "rgba(124,133,148,.10)" : "rgba(255,255,255,.06)";
  const fixedRateLabelColor = light ? "#151922" : "#ffffff";

  return <div className={`ac-rate-chart-native relative overflow-hidden rounded-2xl border p-3 ${light ? "border-[#dfe3ea] bg-[#f1f3f7]" : "border-white/10 bg-white/[0.035]"}`}>
    <style>{`.ac-rate-chart-native>.ac-rate-point-deltas{display:none!important}.ac-rate-chart-native .ac-rate-native-delta{display:block!important}`}</style>
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className={`text-[10px] font-black uppercase tracking-[0.15em] ${light ? "text-[#7a8291]" : "text-white/45"}`}>{selectedPoint ? `Курс на ${fullRateDate(selectedPoint.date)}` : "Курс за 5 дней"}</div>
        <div className="mt-1 text-sm font-black"><span style={{ color: fixedRateLabelColor }}>{meta.nominal > 1 ? `${meta.nominal} ${currency}` : currency} = </span><span style={{ color: selectedColor }}>{new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 5 }).format(selectedValue)} ₽</span></div>
      </div>
      <CurrencyFlag currency={currency} className="h-5 w-7" />
    </div>

    <svg className="mt-2 block w-full overflow-visible" style={{ aspectRatio: `${width} / ${height}` }} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" aria-label={`Изменение курса ${currency} за пять дней`}>
      {[0.25, 0.5, 0.75].map((part) => <line key={part} x1={paddingX} x2={width - paddingX} y1={plotTop + (plotBottom - plotTop) * part} y2={plotTop + (plotBottom - plotTop) * part} stroke={light ? "rgba(28,34,45,.09)" : "rgba(255,255,255,.08)"} strokeWidth="1" strokeDasharray="4 5" />)}
      {coords.map((point, index) => <line key={`guide-${index}`} x1={point.x} x2={point.x} y1={point.y + 7} y2={plotBottom + 12} stroke={light ? "rgba(28,34,45,.09)" : "rgba(255,255,255,.09)"} strokeWidth="1" strokeDasharray="2 5" />)}
      {area ? <path d={area} fill={color} opacity={light ? 0.09 : 0.14} /> : null}
      {line ? <path d={line} fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /> : null}
      {coords.map((point, index) => {
        const delta = index > 0 ? values[index] - values[index - 1] : 0;
        const fill = pointMovementColor(delta, color, light);
        const selected = index === selectedIndex;
        return <circle
          key={`${point.x}-${point.y}`}
          cx={point.x}
          cy={point.y}
          r={selected ? 5.6 : 4.4}
          fill={fill}
          stroke={selected ? (light ? "#ffffff" : "#0f1219") : pointStroke}
          strokeWidth={selected ? 3.2 : 2.1}
          className="cursor-pointer"
          onClick={() => setSelectedIndex(index)}
        />;
      })}
      {coords.map((point, index) => {
        if (index === 0) return null;
        const delta = values[index] - values[index - 1];
        const isFlat = Math.abs(delta) < 1e-12;
        const labelY = Math.min(plotBottom + 20, Math.max(point.y + 16, plotTop + 16));
        const labelColor = isFlat ? (light ? "#7c8594" : "rgba(255,255,255,.55)") : delta < 0 ? "#20a85e" : "#ef3340";
        return <text className="ac-rate-native-delta" key={`delta-${index}`} x={point.x} y={labelY} textAnchor="middle" fill={labelColor} fontSize="8.5" fontWeight="900">{isFlat ? "0" : formatPointDelta(delta)}</text>;
      })}
    </svg>

    <div className="-mt-1 grid grid-cols-5 gap-1.5">
      {points.map((point, index) => {
        const active = index === selectedIndex;
        const idleClass = light ? "border-[#dfe3ea] bg-[#e9edf3] text-[#687282]" : "border-white/10 bg-white/[0.045] text-white/48";
        return <button
          key={point.date}
          type="button"
          onClick={() => setSelectedIndex(index)}
          aria-pressed={active}
          className={`min-w-0 rounded-full border px-1 py-1.5 text-center text-[9px] font-black transition ${active ? "shadow-[0_3px_10px_rgba(41,48,61,.10)]" : idleClass}`}
          style={active ? { borderColor: selectedColor, color: selectedColor, backgroundColor: selectedBackground } : undefined}
        >{shortRateDate(point.date)}</button>;
      })}
    </div>
  </div>;
}

function DetailRow({ label, value, muted, valueClassName = "" }: { label: string; value: string; muted: string; valueClassName?: string }) {
  return <div className="flex min-w-0 items-end gap-2">
    <span className={`shrink-0 ${muted}`}>{label}</span>
    <span className="mb-[3px] min-w-3 flex-1 border-b border-dotted border-current opacity-35" aria-hidden="true" />
    <span className={`shrink-0 whitespace-nowrap ${valueClassName}`}>{value}</span>
  </div>;
}

function CurrencyRateDetails({ rate, impactRub, light = false, compact = false }: { rate: CurrencyRateLike; impactRub?: number; light?: boolean; compact?: boolean }) {
  const currency = String(rate.currency || "").toUpperCase();
  const history = normalizedHistory(rate);
  const currentRate = Number(rate.effectiveRate || history.at(-1)?.effectiveRate || 0);
  const fallbackPrevious = history.length > 1 ? history[history.length - 2].effectiveRate : 0;
  const previousRate = Number(rate.previousEffectiveRate || fallbackPrevious || 0);
  const rateDelta = finiteNumber(rate.rateDelta) || (currentRate && previousRate ? currentRate - previousRate : 0);
  const percent = previousRate ? rateDelta / previousRate * 100 : 0;
  const deltaClass = rateDelta < 0 ? "text-[#20a85e]" : rateDelta > 0 ? "text-[#ef3340]" : light ? "text-[#4f5868]" : "text-white/60";
  const muted = light ? "text-[#6b7483]" : "text-white/58";
  const strong = light ? "text-[#141821]" : "text-white";

  return <div>
    <RateSparkline rate={rate} light={light} />
    <div className={`mt-4 flex items-center gap-2.5 ${strong}`}>
      <span className="ac-pulse-dot ac-pulse-dot--status shrink-0" aria-hidden="true"><span /></span>
      <div className={`${compact ? "text-sm leading-5" : "text-base leading-6"} font-black`}>Пересчитали по актуальному курсу</div>
    </div>
    <div className={`${compact ? "mt-3 gap-2 text-xs" : "mt-4 gap-3 text-sm"} grid font-bold`}>
      <DetailRow label={`Курс ${currency}`} muted={muted} value={`${previousRate ? `${formatRate(previousRate, currency)} ₽ → ` : ""}${formatRate(currentRate, currency)} ₽`} valueClassName={strong} />
      <DetailRow label="Изменение курса" muted={muted} value={`${rateDelta < 0 ? "−" : rateDelta > 0 ? "+" : ""}${formatRate(Math.abs(rateDelta), currency)} ₽ (${percent < 0 ? "−" : percent > 0 ? "+" : ""}${Math.abs(percent).toFixed(2)}%)`} valueClassName={deltaClass} />
      {(rate.previousRateDate || rate.rateDate || history.length) ? <DetailRow label="Период" muted={muted} value={`${fullRateDate(history[0]?.date || rate.previousRateDate)} → ${fullRateDate(history.at(-1)?.date || rate.rateDate)}`} valueClassName={strong} /> : null}
    </div>
    {impactRub ? <div className={`mt-4 border-t pt-3 text-sm font-bold ${light ? "border-[#dde1e8]" : "border-white/10"}`}><DetailRow label="Влияние на ориентир" muted={muted} value={`${impactRub < 0 ? "−" : "+"}${money(Math.abs(impactRub))} ₽`} valueClassName={impactRub < 0 ? "text-[#20a85e]" : "text-[#ef3340]"} /></div> : null}
    <div className={`mt-3 text-[11px] leading-4 ${light ? "text-[#7a8290]" : "text-white/42"}`}>Итоговую цену подтверждает менеджер на момент оплаты.</div>
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
  const [dark, setDark] = useState(() => typeof document !== "undefined" && document.documentElement.dataset.theme === "dark");
  const [dragY, setDragY] = useState(0);
  const dragState = useRef<{ pointerId: number; startY: number; currentY: number; startedAt: number } | null>(null);
  const closeRef = useRef(onClose);
  const rateKey = orderedRates.map((rate) => String(rate.currency).toUpperCase()).join("|");

  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setDark(root.dataset.theme === "dark");
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!open) return;
    const requested = String(initialCurrency || "").toUpperCase();
    setActiveCurrency(orderedRates.some((rate) => String(rate.currency).toUpperCase() === requested) ? requested : String(orderedRates[0]?.currency || "").toUpperCase());
    setDragY(0);
    dragState.current = null;
    const root = document.documentElement;
    const body = document.body;
    const previous = {
      rootOverflow: root.style.overflow,
      rootOverscroll: root.style.overscrollBehavior,
      bodyOverflow: body.style.overflow,
      bodyOverscroll: body.style.overscrollBehavior,
    };
    root.style.overflow = "hidden";
    root.style.overscrollBehavior = "none";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", escape);
    return () => {
      root.style.overflow = previous.rootOverflow;
      root.style.overscrollBehavior = previous.rootOverscroll;
      body.style.overflow = previous.bodyOverflow;
      body.style.overscrollBehavior = previous.bodyOverscroll;
      window.removeEventListener("keydown", escape);
    };
  }, [open, initialCurrency, rateKey]);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (window.matchMedia("(min-width: 768px)").matches) return;
    dragState.current = { pointerId: event.pointerId, startY: event.clientY, currentY: event.clientY, startedAt: performance.now() };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    state.currentY = event.clientY;
    setDragY(Math.max(0, event.clientY - state.startY));
  };
  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const distance = Math.max(0, state.currentY - state.startY);
    const elapsed = Math.max(1, performance.now() - state.startedAt);
    const velocity = distance / elapsed;
    dragState.current = null;
    if (distance > 95 || velocity > 0.65) closeRef.current();
    else setDragY(0);
  };
  const scrollRateTabs = (event: ReactWheelEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    if (node.scrollWidth <= node.clientWidth) return;
    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (!delta) return;
    node.scrollLeft += delta;
    event.preventDefault();
  };

  if (!open || typeof document === "undefined") return null;
  const activeRate = orderedRates.find((rate) => String(rate.currency).toUpperCase() === activeCurrency) || orderedRates[0];
  if (!activeRate) return null;
  const activeCurrencyCode = String(activeRate.currency).toUpperCase();
  const activeCountry = RATE_META[activeCurrencyCode]?.country || activeCurrencyCode;
  const sheetClass = dark ? "bg-[#0f1219] text-white" : "bg-[#f8f9fb] text-[#151922]";
  const headerClass = dark ? "border-white/10 bg-[#0f1219]/95" : "border-[#dfe3e9] bg-[#f8f9fb]/95";
  const handleClass = dark ? "bg-white/60" : "bg-white/85";
  const closeClass = dark ? "bg-white/[0.07] text-white" : "bg-[#edf0f4] text-[#202630]";

  return createPortal(
    <div className="fixed inset-0 z-[14000] flex items-end justify-center overflow-hidden bg-black/75 md:items-center md:p-6" onClick={(event) => { event.preventDefault(); event.stopPropagation(); closeRef.current(); }}>
      <div className={`relative w-full md:max-w-[570px] ${dragState.current ? "" : "transition-transform duration-200 ease-out"}`} style={{ transform: dragY ? `translateY(${dragY}px)` : undefined }} onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}>
        <div className="absolute -top-8 left-1/2 z-20 flex h-8 w-24 -translate-x-1/2 touch-none cursor-grab items-center justify-center active:cursor-grabbing md:hidden" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag} aria-label="Потяните вниз, чтобы закрыть">
          <span className={`block h-1.5 w-12 rounded-full shadow-[0_1px_5px_rgba(0,0,0,.28)] ${handleClass}`} />
        </div>
        <section className={`ac-rate-sheet ac-hide-scrollbar relative max-h-[92dvh] w-full overflow-y-auto overscroll-contain rounded-t-[30px] shadow-[0_-24px_80px_rgba(0,0,0,.38)] md:rounded-[30px] ${sheetClass}`} role="dialog" aria-modal="true" aria-label="Курсы валют">
          <div className={`sticky top-0 z-10 border-b px-5 pb-4 pt-5 backdrop-blur-xl md:rounded-t-[30px] ${headerClass}`}>
            <div className="flex items-center justify-between gap-3">
              <div><div className="text-[13px] font-bold leading-none text-[#ef3340]">{activeCountry}</div><h2 className="mt-1.5 text-xl font-black">{orderedRates.length > 1 ? "Курсы валют" : `Курс ${activeCurrencyCode}`}</h2></div>
              <button type="button" onClick={() => closeRef.current()} className={`flex h-11 w-11 items-center justify-center rounded-full text-2xl font-medium ${closeClass}`} aria-label="Закрыть">×</button>
            </div>
            {orderedRates.length > 1 ? <div
              className="ac-hide-scrollbar -mx-1 mt-4 flex touch-pan-x snap-x snap-proximity gap-2 overflow-x-auto overscroll-x-contain px-1 pb-1"
              style={{ WebkitOverflowScrolling: "touch" }}
              onWheel={scrollRateTabs}
            >
              {orderedRates.map((rate) => {
                const currency = String(rate.currency).toUpperCase();
                const active = currency === activeCurrencyCode;
                const delta = finiteNumber(rate.rateDelta) || (Number(rate.effectiveRate || 0) - Number(rate.previousEffectiveRate || 0));
                const inactiveClass = dark ? "border-white/10 bg-white/[0.05]" : "border-[#dde2e9] bg-[#f0f2f6]";
                const activeClass = dark ? "border-[#ef3340] bg-[#ef3340]/12" : "border-[#ef3340] bg-[#fff0f1]";
                return <button
                  key={currency}
                  type="button"
                  onClick={() => setActiveCurrency(currency)}
                  className={`relative z-[1] min-w-[88px] touch-manipulation snap-start rounded-2xl border px-3 py-2.5 text-left transition active:scale-[.98] ${active ? activeClass : inactiveClass}`}
                >
                  <div className="pointer-events-none flex items-center justify-between gap-2"><CurrencyFlag currency={currency} className="h-4 w-6" /><span className={delta < 0 ? "text-[#20a85e]" : delta > 0 ? "text-[#ef3340]" : dark ? "text-white/45" : "text-[#788190]"}>{delta ? <RateDirectionIcon direction={delta < 0 ? "down" : "up"} className="h-4 w-5" /> : "—"}</span></div>
                  <div className="pointer-events-none mt-1 text-xs font-black">{currency}</div>
                </button>;
              })}
            </div> : null}
          </div>
          <div className="px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-5"><CurrencyRateDetails rate={activeRate} impactRub={impactRub} light={!dark} /></div>
        </section>
      </div>
    </div>,
    document.body,
  );
}

function TrendPopover({ offer, trend, currency, panel, light }: { offer: PriceLike; trend: PriceTrendValue; currency: string; panel: boolean; light: boolean }) {
  const rate = { currency, ...(offer.calculationSnapshot?.currencyRate || {}) };
  const placementClass = panel ? "top-[calc(100%+12px)]" : "bottom-[calc(100%+10px)]";
  const widthClass = panel ? "w-[min(430px,calc(100vw-48px))]" : "w-[min(360px,82vw)]";
  const panelClass = light ? "border-[#dfe3ea] bg-[#f8f9fb] text-[#151922] shadow-[0_20px_65px_rgba(34,40,52,.22)]" : "border-white/10 bg-[#11141c] text-white shadow-[0_20px_65px_rgba(0,0,0,.55)]";
  const tailClass = panel
    ? `absolute -top-1.5 right-3 h-3 w-3 rotate-45 border-l border-t ${light ? "border-[#dfe3ea] bg-[#f8f9fb]" : "border-white/10 bg-[#11141c]"}`
    : `absolute -bottom-1.5 right-3 h-3 w-3 rotate-45 border-b border-r ${light ? "border-[#dfe3ea] bg-[#f8f9fb]" : "border-white/10 bg-[#11141c]"}`;
  return <div className={`ac-price-trend-popover absolute right-0 z-[400] ${widthClass} rounded-2xl border p-3.5 text-left ${panelClass} ${placementClass}`} role="tooltip" onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}>
    <div className={`mb-3 text-[10px] font-black uppercase tracking-[0.15em] ${light ? "text-[#747d8d]" : "text-white/48"}`}>Почему изменилась цена</div>
    <CurrencyRateDetails rate={rate} impactRub={trend.deltaRub} compact light={light} />
    <span className={tailClass} />
  </div>;
}

export function PriceTrend({ offer, label = "Ориентир", priceClassName = "text-[22px]", className = "", panel = false, dense = false }: { offer: PriceLike; label?: string; priceClassName?: string; className?: string; panel?: boolean; dense?: boolean }) {
  const currency = String(offer.sourceCurrency || offer.calculationSnapshot?.currencyRate?.currency || "").toUpperCase();
  const [liveRate, setLiveRate] = useState<LiveRate | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [desktopHover, setDesktopHover] = useState(false);
  const [lightTheme, setLightTheme] = useState(() => typeof document !== "undefined" && document.documentElement.dataset.theme === "light");
  const trendRoot = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!currency || currency === "RUB") return;
    let active = true;
    void loadLiveRates().then((rates) => { if (active) setLiveRate(rates[currency] || null); });
    return () => { active = false; };
  }, [currency]);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px) and (hover: hover) and (pointer: fine)");
    const sync = () => { setDesktopHover(media.matches); if (!media.matches) setPopoverOpen(false); };
    sync();
    media.addEventListener?.("change", sync);
    return () => media.removeEventListener?.("change", sync);
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setLightTheme(root.dataset.theme === "light");
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
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
  const sheetRate: PublicCurrencyRate | null = currency && pricedOffer.calculationSnapshot?.currencyRate?.effectiveRate ? { currency, ...(pricedOffer.calculationSnapshot.currencyRate as PublicCurrencyRate) } : liveRate;

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
        onMouseEnter={() => { if (desktopHover) setPopoverOpen(true); }}
        onMouseLeave={() => { if (desktopHover) setPopoverOpen(false); }}
        onPointerDown={(event) => {
          if (event.pointerType === "mouse" && desktopHover) return;
          event.preventDefault();
          event.stopPropagation();
          setPopoverOpen(false);
          setSheetOpen(true);
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (desktopHover) setPopoverOpen(true);
          else { setPopoverOpen(false); setSheetOpen(true); }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            if (desktopHover) setPopoverOpen((current) => !current);
            else setSheetOpen(true);
          }
        }}
      >
        <TrendArrow direction={trend.direction} className={dense ? "h-5 w-7 sm:h-6 sm:w-8" : "h-6 w-8 md:h-7 md:w-10"} />
        {desktopHover && popoverOpen ? <TrendPopover offer={pricedOffer} trend={trend} currency={currency || "валюты"} panel={panel} light={lightTheme} /> : null}
      </span> : null}
    </div>
    {sheetRate && trend ? <CurrencyRatesSheet open={sheetOpen} onClose={() => setSheetOpen(false)} rates={[sheetRate]} initialCurrency={currency} impactRub={trend.deltaRub} /> : null}
  </div>;
}
