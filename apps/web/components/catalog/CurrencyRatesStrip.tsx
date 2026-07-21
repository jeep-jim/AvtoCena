"use client";

import { useEffect, useMemo, useRef, useState, type WheelEvent as ReactWheelEvent } from "react";
import { CurrencyFlag, CurrencyRatesSheet, type PublicCurrencyRate } from "@/components/catalog/PriceTrend";

type Variant = "mobile" | "desktop";

type Props = {
  rates?: PublicCurrencyRate[];
  variant?: Variant;
  className?: string;
};

const DISPLAY_RATES: Record<Variant, Array<[string, number]>> = {
  desktop: [
    ["JPY", 100],
    ["CNY", 1],
    ["KRW", 1000],
    ["AED", 1],
    ["EUR", 1],
  ],
  mobile: [
    ["JPY", 100],
    ["CNY", 1],
    ["KRW", 1000],
    ["AED", 1],
    ["EUR", 1],
    ["GEL", 1],
  ],
};

function rateColor(delta: number) {
  if (delta < 0) return "text-[#31b765]";
  if (delta > 0) return "text-[#ef3340]";
  return "text-[var(--ac-muted)]";
}

function displayRate(rate: PublicCurrencyRate | undefined, amount: number) {
  if (!rate) return "—";
  const value = Number(rate.effectiveRate || 0) * amount;
  const digits = amount > 1 ? 2 : value < 1 ? 4 : 2;
  return `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(value)} ₽`;
}

export function CurrencyRatesStrip({ rates: suppliedRates, variant = "mobile", className = "" }: Props) {
  const [loadedRates, setLoadedRates] = useState<PublicCurrencyRate[]>(suppliedRates || []);
  const [open, setOpen] = useState(false);
  const [initialCurrency, setInitialCurrency] = useState("JPY");
  const pointer = useRef<{ x: number; moved: boolean } | null>(null);

  useEffect(() => {
    if (suppliedRates?.length) {
      setLoadedRates(suppliedRates);
      return;
    }
    let cancelled = false;
    fetch(`/api/catalog/search?pageSize=1&includeRates=1&_=${Date.now()}`, { cache: "no-store", headers: { "cache-control": "no-cache" } })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!cancelled) setLoadedRates(Array.isArray(data?.rates) ? data.rates : []);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [suppliedRates]);

  const rateMap = useMemo(() => new Map(loadedRates.map((rate) => [String(rate.currency).toUpperCase(), rate])), [loadedRates]);
  const tiles = DISPLAY_RATES[variant];

  const wheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    if (node.scrollWidth <= node.clientWidth) return;
    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (!delta) return;
    node.scrollLeft += delta;
    event.preventDefault();
  };

  const openCurrency = (currency: string) => {
    if (pointer.current?.moved) {
      pointer.current = null;
      return;
    }
    setInitialCurrency(currency);
    setOpen(true);
  };

  const shell = variant === "desktop"
    ? "rounded-[1.6rem] p-4"
    : "rounded-[1.35rem] px-2 py-3";
  const rail = variant === "desktop"
    ? "grid grid-cols-5 gap-2"
    : "ac-hide-scrollbar flex touch-pan-x gap-2 overflow-x-auto overscroll-x-contain";

  return <>
    <section className={`ac-currency-rates-strip ${shell} ${className}`} aria-label="Курсы валют">
      {variant === "desktop" ? <h3 className="mb-3 text-lg font-black">Курс валют</h3> : null}
      <div
        className={rail}
        style={{ WebkitOverflowScrolling: "touch" }}
        onWheel={wheel}
        onPointerDown={(event) => { pointer.current = { x: event.clientX, moved: false }; }}
        onPointerMove={(event) => { if (pointer.current && Math.abs(event.clientX - pointer.current.x) > 7) pointer.current.moved = true; }}
        onPointerUp={() => { window.setTimeout(() => { pointer.current = null; }, 0); }}
        onPointerCancel={() => { pointer.current = null; }}
      >
        {tiles.map(([currency, amount]) => {
          const rate = rateMap.get(currency);
          const delta = Number(rate?.rateDelta || 0) || (Number(rate?.effectiveRate || 0) - Number(rate?.previousEffectiveRate || 0));
          return <button
            key={currency}
            type="button"
            onClick={() => openCurrency(currency)}
            className={`relative z-[1] flex touch-manipulation flex-col items-center justify-center rounded-xl px-1.5 py-2 text-center transition active:scale-[.97] ${variant === "desktop" ? "min-w-0 bg-white/[0.045]" : "min-w-[62px] flex-1"}`}
            aria-label={`Открыть курс ${currency}`}
          >
            <CurrencyFlag currency={currency} className="h-4 w-6" />
            <span className="pointer-events-none mt-1 text-[9px] font-black">{currency}</span>
            <span className={`pointer-events-none mt-0.5 block text-[10px] font-black ${rateColor(delta)}`}>{displayRate(rate, amount)}</span>
          </button>;
        })}
      </div>
      {variant === "desktop" ? <div className="mt-2 text-[9px] font-bold text-[var(--ac-muted)]">Графики и изменение курса за 5 дней</div> : null}
    </section>
    <CurrencyRatesSheet open={open} onClose={() => setOpen(false)} rates={loadedRates} initialCurrency={initialCurrency} />
  </>;
}
