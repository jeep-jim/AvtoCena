"use client";

import { useEffect, useState } from "react";

type Preview = {
  src: string;
  alt: string;
};

type LiveCatalogOffer = {
  title?: string;
  totalRub?: number | null;
  previousTotalRub?: number | null;
  priceDeltaRub?: number | null;
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

const BUDGETS: Record<string, { min?: number; max?: number }> = {
  "to-1500000": { max: 1_500_000 },
  "to-2000000": { max: 2_000_000 },
  "to-2500000": { max: 2_500_000 },
  "to-3000000": { max: 3_000_000 },
  "to-4000000": { max: 4_000_000 },
  "to-5000000": { max: 5_000_000 },
  "to-6000000": { max: 6_000_000 },
  "from-6000000": { min: 6_000_000 },
};

const RATE_NOMINAL: Record<string, number> = {
  JPY: 100,
  KRW: 1000,
};

function cleanText(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeTitle(value: string | null | undefined) {
  return cleanText(value).toLocaleLowerCase("ru-RU").replace(/[^a-zа-яё0-9]+/gi, " ").trim();
}

function filterRoot(form: HTMLElement, key: string) {
  return form.querySelector<HTMLElement>(`[data-ac-filter-key="${key}"]`) || undefined;
}

function optionValue(root: HTMLElement | undefined) {
  if (!root) return "";
  const custom = cleanText(root.dataset.acCustomValue);
  if (custom) return custom;
  return cleanText(root.dataset.acValue);
}

function readHomeFilterParams() {
  const form = document.querySelector<HTMLElement>("#form");
  if (!form) return null;
  const budgetRoot = filterRoot(form, "budget");
  const makeRoot = filterRoot(form, "make");
  const modelRoot = filterRoot(form, "model");
  const yearRoot = filterRoot(form, "year");
  const marketRoot = filterRoot(form, "market");
  const bodyRoot = filterRoot(form, "body");
  const searchRoots = [makeRoot, modelRoot].filter(Boolean) as HTMLElement[];
  const budget = BUDGETS[optionValue(budgetRoot)] || {};
  const brand = optionValue(makeRoot);
  const model = optionValue(modelRoot);
  const year = optionValue(yearRoot);
  const market = optionValue(marketRoot);
  const body = optionValue(bodyRoot);
  const params = new URLSearchParams({ pageSize: "1", sort: "updatedAt" });
  if (budget.min) params.set("budgetFrom", String(budget.min));
  if (budget.max) params.set("budgetTo", String(budget.max));
  if (brand) { params.set("make", brand); params.set("brand", brand); }
  if (model) params.set("model", model);
  if (year === "older") params.set("yearTo", "2017");
  else if (year) params.set("yearFrom", year);
  if (market) { params.set("market", market); params.set("country", market); }
  if (body) { params.set("bodyType", body); params.set("body", body); }
  return { form, params, searchRoots };
}

function formatDelta(value: number) {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(absolute / 1_000_000)}M`;
  return `${Math.round(absolute / 1_000)}K`;
}

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
        const response = await fetch(`/api/catalog/search?pageSize=1&includeRates=1&_=${Date.now()}`, { cache: "no-store", headers: { "cache-control": "no-cache" } });
        if (!response.ok) return;
        const data = await response.json();
        if (disposed) return;
        rateMap = new Map((Array.isArray(data?.rates) ? data.rates : []).map((rate: PublicRate) => [String(rate.currency || "").toUpperCase(), rate]));
        scheduleApply();
      } catch {
        // The charts remain usable without the optional point labels.
      }
    };

    const observer = new MutationObserver(scheduleApply);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-label"] });
    void loadRates();
    const interval = window.setInterval(loadRates, 60_000);

    return () => {
      disposed = true;
      observer.disconnect();
      window.clearInterval(interval);
      window.cancelAnimationFrame(frame);
      if (createdStyle) style?.remove();
    };
  }, []);

  useEffect(() => {
    let countTimer = 0;
    let countController: AbortController | null = null;
    let trendController: AbortController | null = null;
    let trendOffers: LiveCatalogOffer[] = [];

    const restoreCustomLabels = () => {
      const state = readHomeFilterParams();
      for (const root of state?.searchRoots || []) {
        const custom = cleanText(root.dataset.acCustomValue);
        const label = root.querySelector<HTMLElement>("button.ac-search-select > span");
        if (custom && label && cleanText(label.textContent) !== custom) label.textContent = custom;
      }
    };

    const updateCount = async () => {
      const state = readHomeFilterParams();
      if (!state) return;
      countController?.abort();
      countController = new AbortController();
      try {
        const response = await fetch(`/api/catalog/search?${state.params.toString()}`, { cache: "no-store", signal: countController.signal });
        if (!response.ok) return;
        const data = await response.json();
        const count = Number(data?.total ?? data?.items?.length ?? 0);
        const badge = [...state.form.querySelectorAll<HTMLElement>("div,span")].find((node) => /Нашли\s+\d+\s+вариант/i.test(cleanText(node.textContent)) && ![...node.children].some((child) => /Нашли\s+\d+/i.test(cleanText(child.textContent))));
        if (badge) badge.textContent = `Нашли ${new Intl.NumberFormat("ru-RU").format(count)} вариантов`;
      } catch (error) {
        if ((error as Error)?.name !== "AbortError") console.warn("home_filter_count_failed");
      }
    };

    const scheduleCount = () => {
      window.clearTimeout(countTimer);
      countTimer = window.setTimeout(() => {
        restoreCustomLabels();
        void updateCount();
      }, 180);
    };

    const enhanceSearchInput = (input: HTMLInputElement) => {
      const menu = input.closest<HTMLElement>(".ac-search-menu");
      const root = menu?.parentElement;
      const list = menu?.querySelector<HTMLElement>("[role='listbox']");
      if (!root || !list) return;
      list.querySelector(".ac-custom-search-option")?.remove();
      const query = cleanText(input.value);
      if (query.length < 2) return;
      const exact = [...list.querySelectorAll<HTMLButtonElement>("button[role='option']")].some((button) => cleanText(button.textContent).toLocaleLowerCase("ru-RU") === query.toLocaleLowerCase("ru-RU"));
      if (exact) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ac-custom-search-option flex min-h-11 w-full items-center rounded-xl px-3 py-2 text-left text-sm font-black text-red-300 hover:bg-white/[0.07]";
      button.dataset.value = query;
      button.textContent = `Искать «${query}»`;
      list.prepend(button);
    };

    const applyTrends = () => {
      if (!trendOffers.length) return;
      const sectionHeading = [...document.querySelectorAll<HTMLElement>("h2")].find((heading) => cleanText(heading.textContent) === "Автомобили в каталоге");
      const section = sectionHeading?.closest("section");
      if (!section) return;
      const byTitle = new Map(trendOffers.map((offer) => [normalizeTitle(offer.title), offer]));
      for (const card of section.querySelectorAll<HTMLElement>(".ac-catalog-card")) {
        if (card.querySelector(".ac-live-price-trend")) continue;
        const title = card.querySelector<HTMLImageElement>("img[alt]")?.alt || "";
        const offer = byTitle.get(normalizeTitle(title));
        const current = Number(offer?.totalRub || 0);
        const previous = Number(offer?.previousTotalRub || 0);
        const delta = Number(offer?.priceDeltaRub || 0) || (current && previous ? current - previous : 0);
        if (!Number.isFinite(delta) || Math.abs(delta) < 1_000) continue;
        const price = [...card.querySelectorAll<HTMLElement>("div")].find((node) => /₽/.test(cleanText(node.textContent)) && node.children.length === 0);
        const host = price?.parentElement;
        if (!host) continue;
        host.classList.add("relative");
        const badge = document.createElement("span");
        badge.className = `ac-live-price-trend ${delta < 0 ? "is-down" : "is-up"}`;
        badge.textContent = `${delta < 0 ? "−" : "+"}${formatDelta(delta)} ${delta < 0 ? "↘" : "↗"}`;
        badge.title = delta < 0 ? "Цена снизилась" : "Цена выросла";
        host.appendChild(badge);
      }
    };

    const loadTrends = async () => {
      trendController?.abort();
      trendController = new AbortController();
      try {
        const response = await fetch("/api/catalog/search?pageSize=48&sort=updatedAt", { cache: "no-store", signal: trendController.signal });
        if (!response.ok) return;
        const data = await response.json();
        trendOffers = Array.isArray(data?.items) ? data.items : [];
        applyTrends();
      } catch (error) {
        if ((error as Error)?.name !== "AbortError") console.warn("home_price_trends_failed");
      }
    };

    const handleInput = (event: Event) => {
      const input = event.target as HTMLInputElement | null;
      if (input?.closest(".ac-search-menu")) enhanceSearchInput(input);
      scheduleCount();
    };

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const custom = target?.closest<HTMLButtonElement>(".ac-custom-search-option");
      if (custom) {
        event.preventDefault();
        event.stopPropagation();
        const root = custom.closest<HTMLElement>(".ac-search-menu")?.parentElement;
        const value = cleanText(custom.dataset.value);
        if (root && value) {
          root.dataset.acCustomValue = value;
          const label = root.querySelector<HTMLElement>("button.ac-search-select > span");
          if (label) label.textContent = value;
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
          scheduleCount();
        }
        return;
      }

      const normalOption = target?.closest<HTMLButtonElement>("button[role='option']");
      if (normalOption) {
        const root = normalOption.closest<HTMLElement>(".ac-search-menu")?.parentElement;
        if (root) delete root.dataset.acCustomValue;
        scheduleCount();
      }

      const submit = target?.closest<HTMLButtonElement>("#form button.avto-button");
      if (!submit) return;
      const state = readHomeFilterParams();
      const hasCustom = state?.searchRoots.some((root) => cleanText(root.dataset.acCustomValue));
      if (!state || !hasCustom) return;
      event.preventDefault();
      event.stopPropagation();
      const resultParams = new URLSearchParams(state.params);
      resultParams.delete("pageSize");
      resultParams.delete("sort");
      if (resultParams.has("budgetTo")) { resultParams.set("budget", resultParams.get("budgetTo")!); resultParams.delete("budgetTo"); }
      resultParams.delete("make");
      resultParams.delete("country");
      resultParams.delete("bodyType");
      window.location.assign(`/results?${resultParams.toString()}`);
    };

    const observer = new MutationObserver(() => {
      restoreCustomLabels();
      applyTrends();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("input", handleInput, true);
    document.addEventListener("change", scheduleCount, true);
    document.addEventListener("click", handleClick, true);
    scheduleCount();
    void loadTrends();

    return () => {
      window.clearTimeout(countTimer);
      countController?.abort();
      trendController?.abort();
      observer.disconnect();
      document.removeEventListener("input", handleInput, true);
      document.removeEventListener("change", scheduleCount, true);
      document.removeEventListener("click", handleClick, true);
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
