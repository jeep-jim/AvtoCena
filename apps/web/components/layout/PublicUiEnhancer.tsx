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
