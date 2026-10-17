"use client";

import { useEffect, useState } from "react";
import { loadPublicRates } from "../../lib/catalog/public-rates-client";

type Preview = {
  src: string;
  alt: string;
};

type PublicRatePoint = {
  date?: string;
  effectiveRate?: number;
};

type PublicRate = {
  currency?: string;
  effectiveRate?: number;
  previousEffectiveRate?: number;
  previousRateDate?: string;
  rateDate?: string;
  history?: PublicRatePoint[];
};

const RATE_NOMINAL: Record<string, number> = {
  JPY: 100,
  KRW: 1000,
};

function validRateDate(value: unknown) {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function shiftRateDate(value: string, offset: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function normalizeRatePoints(rate: PublicRate) {
  const unique = new Map<string, number>();
  for (const point of Array.isArray(rate.history) ? rate.history : []) {
    const date = validRateDate(point?.date);
    const effectiveRate = Number(point?.effectiveRate || 0);
    if (date && effectiveRate > 0) unique.set(date, effectiveRate);
  }

  const currentDate = validRateDate(rate.rateDate);
  const previousDate = validRateDate(rate.previousRateDate);
  const current = Number(rate.effectiveRate || 0);
  const previous = Number(rate.previousEffectiveRate || 0);
  if (previousDate && previous > 0) unique.set(previousDate, previous);
  if (currentDate && current > 0) unique.set(currentDate, current);

  const actual = [...unique]
    .map(([date, effectiveRate]) => ({ date, effectiveRate }))
    .sort((left, right) => left.date.localeCompare(right.date));
  const endDate = [currentDate, actual.at(-1)?.date].filter(Boolean).sort().at(-1) || new Date().toISOString().slice(0, 10);
  const dates = Array.from({ length: 5 }, (_, index) => shiftRateDate(endDate, index - 4));
  const fallback = current || previous || actual.at(-1)?.effectiveRate || 0;

  return dates.map((date) => {
    const exact = unique.get(date);
    if (exact) return { date, effectiveRate: exact };
    const earlier = [...actual].reverse().find((point) => point.date <= date);
    const later = actual.find((point) => point.date >= date);
    return { date, effectiveRate: earlier?.effectiveRate || later?.effectiveRate || fallback };
  }).filter((point) => point.effectiveRate > 0);
}

function formatRatePointDelta(value: number) {
  const absolute = Math.abs(value);
  const maximumFractionDigits = absolute >= 10 ? 0 : absolute >= 1 ? 2 : absolute >= 0.1 ? 2 : 3;
  const formatted = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits }).format(absolute);
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatted}`;
}

export function PublicUiEnhancer() {
  const [preview, setPreview] = useState<Preview | null>(null);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const image = target?.closest<HTMLImageElement>(".ac-offer-panel img");
      if (!image || image.closest("button") || !image.currentSrc) return;
      event.preventDefault();
      setPreview({ src: image.currentSrc, alt: image.alt || "Фотография автомобиля" });
    };

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  useEffect(() => {
    if (!preview) return;
    const previousOverflow = document.body.style.overflow;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(null);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", close);
    };
  }, [preview]);

  useEffect(() => {
    const styleId = "ac-currency-ui-enhancements";
    let style = document.getElementById(styleId) as HTMLStyleElement | null;
    const createdStyle = !style;
    if (!style) {
      style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        .ac-rate-chart-host{position:relative!important}
        .ac-rate-point-deltas{position:absolute;left:27px;right:27px;top:96px;z-index:3;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));pointer-events:none;font-size:9px;font-weight:900;line-height:1;text-align:center}
        .ac-rate-point-deltas>span{min-height:14px}
        .ac-rate-point-deltas>span:not(:empty){justify-self:center;padding:2px 4px;border-radius:999px;background:rgba(15,18,25,.74);box-shadow:0 2px 7px rgba(0,0,0,.18);text-shadow:0 1px 2px rgba(0,0,0,.24)}
        .ac-rate-point-deltas>span.is-up{color:#ff4b55}
        .ac-rate-point-deltas>span.is-down{color:#31b765}
        .ac-rate-point-deltas>span.is-flat{color:rgba(255,255,255,.46)}
        html[data-theme="light"] .ac-rate-point-deltas>span:not(:empty){background:rgba(241,243,247,.88);box-shadow:0 2px 7px rgba(31,38,50,.1);text-shadow:none}
        html[data-theme="light"] .ac-rate-point-deltas>span.is-flat{color:#7b8493}

        @media(min-width:1024px){
          .ac-home-page>div.mx-auto{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(330px,410px)!important;column-gap:18px!important;align-items:stretch!important}
          .ac-home-page>div.mx-auto>.ac-home-hero{grid-column:1/-1!important;grid-row:1!important}
          .ac-home-page>div.mx-auto>.ac-mobile-rates+section{grid-column:1/-1!important;grid-row:2!important}
          .ac-home-page>div.mx-auto>.ac-mobile-rates{display:grid!important;grid-column:2!important;grid-row:3!important;align-self:stretch!important;grid-template-columns:repeat(5,minmax(0,1fr))!important;gap:8px!important;margin-top:1rem!important;padding:18px 14px 14px!important;border-radius:1.6rem!important;background:rgba(255,255,255,.045)!important;box-shadow:0 18px 54px rgba(0,0,0,.16)!important;cursor:pointer!important;transition:transform .18s ease,background-color .18s ease!important}
          .ac-home-page>div.mx-auto>.ac-mobile-rates:hover{transform:translateY(-1px)!important;background:rgba(255,255,255,.06)!important}
          .ac-home-page>div.mx-auto>.ac-mobile-rates::before{content:"Курс валют";grid-column:1/-1;display:block;margin:0 2px 4px;text-align:left;color:var(--ac-text,#fff);font-size:20px;font-weight:900;line-height:1.1;letter-spacing:-.025em}
          .ac-home-page>div.mx-auto>.ac-mobile-rates::after{content:"Графики и изменение курса за 5 дней";grid-column:1/-1;display:block;margin:2px 2px 0;text-align:left;color:var(--ac-muted,rgba(255,255,255,.56));font-size:10px;font-weight:800;line-height:1.35}
          .ac-home-page>div.mx-auto>.ac-mobile-rates>span{display:flex!important;min-width:0!important;min-height:82px!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;border-radius:16px!important;background:rgba(255,255,255,.055)!important;padding:9px 3px!important}
          .ac-home-page>div.mx-auto>.ac-mobile-rates>span>span:first-child{font-size:18px!important;line-height:1!important}
          .ac-home-page>div.mx-auto>.ac-mobile-rates>span>span:nth-child(2){margin-top:5px!important;font-size:10px!important}
          .ac-home-page>div.mx-auto>.ac-mobile-rates>span>span:nth-child(3){margin-top:4px!important;font-size:10px!important;white-space:nowrap!important}
          .ac-home-page>div.mx-auto>.ac-mobile-rates>span>span:last-child{margin-top:4px!important;font-size:10px!important}
          .ac-home-page>div.mx-auto>.ac-executor-block{grid-column:1!important;grid-row:3!important;grid-template-columns:minmax(0,1fr) minmax(190px,250px)!important}
          .ac-home-page>div.mx-auto>.ac-executor-block+section{grid-column:1/-1!important;grid-row:4!important}
          html[data-theme="light"] .ac-home-page>div.mx-auto>.ac-mobile-rates{background:#fff!important;box-shadow:0 18px 48px rgba(45,50,64,.13)!important}
          html[data-theme="light"] .ac-home-page>div.mx-auto>.ac-mobile-rates:hover{background:#f8f9fb!important}
          html[data-theme="light"] .ac-home-page>div.mx-auto>.ac-mobile-rates>span{background:#eef1f5!important}
        }
      `;
      document.head.appendChild(style);
    }

    let disposed = false;
    let frame = 0;
    let rateMap = new Map<string, PublicRate>();

    const applyRatePointDeltas = () => {
      if (!rateMap.size) return;
      for (const svg of document.querySelectorAll<SVGSVGElement>('svg[aria-label^="Изменение курса "]')) {
        const currency = String(svg.getAttribute("aria-label")?.match(/Изменение курса\s+([A-Z]{3})/i)?.[1] || "").toUpperCase();
        const rate = rateMap.get(currency);
        const host = svg.parentElement as HTMLElement | null;
        if (!currency || !rate || !host) continue;
        const points = normalizeRatePoints(rate);
        if (points.length !== 5) continue;
        const nominal = RATE_NOMINAL[currency] || 1;
        const signature = `${currency}:${points.map((point) => `${point.date}:${point.effectiveRate}`).join("|")}`;
        host.classList.add("ac-rate-chart-host");
        let overlay = host.querySelector<HTMLElement>(":scope > .ac-rate-point-deltas");
        if (overlay?.dataset.signature === signature) continue;
        if (!overlay) {
          overlay = document.createElement("div");
          overlay.className = "ac-rate-point-deltas";
          overlay.setAttribute("aria-hidden", "true");
          host.appendChild(overlay);
        }
        overlay.dataset.signature = signature;
        overlay.replaceChildren(...points.map((point, index) => {
          const label = document.createElement("span");
          if (index === 0) return label;
          const delta = (point.effectiveRate - points[index - 1].effectiveRate) * nominal;
          label.className = delta > 1e-9 ? "is-up" : delta < -1e-9 ? "is-down" : "is-flat";
          label.textContent = formatRatePointDelta(delta);
          return label;
        }));
      }
    };

    const scheduleApply = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(applyRatePointDeltas);
    };

    const loadRates = async () => {
      try {
        if (document.visibilityState === "hidden") return;
        const rates = await loadPublicRates();
        if (disposed) return;
        rateMap = new Map(rates.map((rate: PublicRate) => [String(rate.currency || "").toUpperCase(), rate]));
        scheduleApply();
      } catch {
        // The charts remain usable without the optional point labels.
      }
    };

    const observer = new MutationObserver(scheduleApply);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-label"] });
    void loadRates();
    const interval = window.setInterval(loadRates, 15 * 60_000);
    const resumeRates = () => { if (document.visibilityState === "visible") void loadRates(); };
    document.addEventListener("visibilitychange", resumeRates);

    return () => {
      disposed = true;
      observer.disconnect();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", resumeRates);
      window.cancelAnimationFrame(frame);
      if (createdStyle) style?.remove();
    };
  }, []);


  if (!preview) return null;

  return (
    <div className="ac-image-lightbox fixed inset-0 z-[10050] flex items-center justify-center bg-black/90 p-3 backdrop-blur-md sm:p-8" role="dialog" aria-modal="true" aria-label="Просмотр фотографии" onClick={() => setPreview(null)}>
      <img src={preview.src} alt={preview.alt} className="max-h-full max-w-full select-none object-contain" onClick={(event) => event.stopPropagation()} />
      <button type="button" onClick={() => setPreview(null)} className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur sm:right-6 sm:top-6" aria-label="Закрыть фотографию">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M3 3L15 15M15 3L3 15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
      </button>
    </div>
  );
}
