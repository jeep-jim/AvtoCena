"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

type ModelSuggestion = {
  id?: string;
  make: string;
  model: string;
  aliases?: string[];
  label: string;
};

type ModelSelection = { make: string; model: string };
type ContextFacets = {
  makes?: string[];
  bodyTypes?: string[];
  fuels?: string[];
  transmissions?: string[];
  drives?: string[];
};

let catalogFilterDependentUiMounted = false;

const CONTEXT_KEYS = [
  "market", "make", "model", "bodyType", "transmission", "fuel", "drive",
  "yearFrom", "yearTo", "budgetFrom", "budgetTo", "mileageFrom", "mileageTo",
  "engineFrom", "engineTo", "powerFrom", "powerTo",
] as const;

const BODY_LABELS: Record<string, string> = {
  suv: "Кроссовер", offroad: "Внедорожник", sedan: "Седан", hatchback: "Хэтчбек",
  wagon: "Универсал", minivan: "Минивэн", coupe: "Купе", convertible: "Кабриолет",
  pickup: "Пикап", van: "Фургон",
};
const FUEL_LABELS: Record<string, string> = { petrol: "Бензин", diesel: "Дизель", hybrid: "Гибрид", electric: "Электро", lpg: "Газ" };
const TRANSMISSION_LABELS: Record<string, string> = { automatic: "Автомат", manual: "Механика", cvt: "Вариатор", dct: "Робот" };
const DRIVE_LABELS: Record<string, string> = { fwd: "Передний", rwd: "Задний", awd: "Полный" };

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function compact(value: unknown) {
  return clean(value).toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, "");
}

function currentCatalogContext(includeModel = true) {
  const result = new URLSearchParams();
  if (typeof window === "undefined") return result;
  const current = new URLSearchParams(window.location.search);
  for (const key of CONTEXT_KEYS) {
    if (!includeModel && key === "model") continue;
    let value = clean(current.get(key));
    if (key === "budgetTo" && !value) value = clean(current.get("budget"));
    if (value) result.set(key, value);
  }
  return result;
}

function hasContext(params: URLSearchParams) {
  return CONTEXT_KEYS.some((key) => Boolean(params.get(key)));
}

function labelSet(values: string[] | undefined, labels?: Record<string, string>) {
  return new Set((values || []).map((value) => labels?.[clean(value)] || clean(value)).filter(Boolean));
}

function allowedFacetLabels(name: string, facets: ContextFacets) {
  if (name === "make") return labelSet(facets.makes);
  if (name === "bodyType") return labelSet(facets.bodyTypes, BODY_LABELS);
  if (name === "transmission") return labelSet(facets.transmissions, TRANSMISSION_LABELS);
  if (name === "fuel") return labelSet(facets.fuels, FUEL_LABELS);
  if (name === "drive") return labelSet(facets.drives, DRIVE_LABELS);
  return new Set<string>();
}

function selectedFacetLabel(name: string, value: string) {
  if (name === "bodyType") return BODY_LABELS[value] || value;
  if (name === "transmission") return TRANSMISSION_LABELS[value] || value;
  if (name === "fuel") return FUEL_LABELS[value] || value;
  if (name === "drive") return DRIVE_LABELS[value] || value;
  return value;
}

function applyDependentFacetOptions(facets: ContextFacets | null) {
  const names = new Set(["make", "bodyType", "transmission", "fuel", "drive"]);
  document.querySelectorAll<HTMLInputElement>('.ac-catalog-filter-panel input[type="hidden"][name], .ac-mobile-filter-sheet input[type="hidden"][name]').forEach((hidden) => {
    if (!names.has(hidden.name)) return;
    const root = hidden.parentElement;
    const dropdown = root?.querySelector<HTMLElement>(":scope > .ac-filter-dropdown");
    if (!dropdown) return;
    const allowed = facets ? allowedFacetLabels(hidden.name, facets) : null;
    const selected = hidden.name === "make"
      ? new Set(clean(hidden.value).split(",").map(clean).filter(Boolean))
      : new Set([selectedFacetLabel(hidden.name, clean(hidden.value))].filter(Boolean));
    dropdown.querySelectorAll<HTMLButtonElement>(".ac-filter-option").forEach((option, index) => {
      const text = clean(option.dataset.facetValue || option.querySelector(":scope > span")?.textContent || option.textContent).replace(/✓$/, "").trim();
      const keep = !allowed || index === 0 || !text || allowed.has(text) || selected.has(text);
      option.classList.toggle("ac-facet-incompatible", !keep);
      option.setAttribute("aria-hidden", keep ? "false" : "true");
    });
  });
}

function ensureCatalogFilterLayoutPolish() {
  const styleId = "ac-catalog-filter-layout-dependent-polish";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .ac-facet-incompatible{display:none!important}
      @media(min-width:1024px){
        .ac-catalog-filter-panel input.ac-filter-control[name="model"]{height:52px!important;min-height:52px!important;border-radius:15px!important}
        .ac-catalog-filter-panel .ac-primary-lower-grid{grid-template-columns:calc((100% - 20px)/3) calc((100% - 20px)/3) minmax(0,1fr) minmax(180px,.58fr)!important;gap:10px!important}
      }
      @media(max-width:1023px){
        .ac-mobile-filter-sheet input.ac-filter-control[name="model"]{height:46px!important;min-height:46px!important;border-radius:13px!important}
        .ac-mobile-filter-sheet .ac-mobile-market-field{display:none!important}
        .ac-mobile-filter-sheet .ac-mobile-secondary-grid{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:7px!important}
        .ac-mobile-filter-sheet .ac-mobile-secondary-grid .ac-filter-control{min-width:0!important;padding-left:11px!important;padding-right:11px!important;font-size:12px!important}
        .ac-mobile-filter-sheet .ac-mobile-secondary-grid>.ac-mobile-secondary-span{grid-column:1/-1!important}
        .ac-mobile-filter-sheet .ac-mobile-eyebrow-hidden{display:none!important}
        .ac-mobile-filter-sheet.ac-mobile-filter-sheet.ac-mobile-filter-sheet .ac-filter-clear--mobile{margin-left:auto!important;margin-right:24px!important}
        .ac-filter-more-button>.ac-filter-tray-main{display:inline-flex!important;align-items:center!important;gap:8px!important;min-width:0!important}
        .ac-filter-more-button>.ac-filter-tray-main>svg{width:20px!important;height:20px!important;flex:0 0 20px!important}
        .ac-filter-more-button>.ac-filter-tray-clear{order:5!important;margin-left:auto!important;margin-right:0!important}
      }
    `;
    document.head.appendChild(style);
  }

  const desktop = document.querySelector<HTMLElement>(".ac-catalog-filter-panel");
  if (desktop) {
    Array.from(desktop.children).forEach((child) => {
      const row = child as HTMLElement;
      if (row.querySelector(".ac-power-limit") && row.querySelector(".ac-electric-filter") && row.querySelector(".ac-sort-control")) row.classList.add("ac-primary-lower-grid");
    });
  }

  const sheet = document.querySelector<HTMLElement>(".ac-mobile-filter-sheet");
  if (sheet) {
    const header = sheet.querySelector<HTMLElement>(":scope > div:first-child > div:nth-child(2)");
    header?.querySelectorAll<HTMLElement>("div").forEach((element) => {
      if (!element.children.length && clean(element.textContent).toLocaleLowerCase("ru-RU") === "каталог") element.classList.add("ac-mobile-eyebrow-hidden");
    });

    sheet.querySelectorAll<HTMLInputElement>('input[type="hidden"][name="market"]').forEach((input) => input.parentElement?.classList.add("ac-mobile-market-field"));

    const advanced = sheet.querySelector<HTMLElement>(".ac-advanced-fields");
    advanced?.querySelectorAll<HTMLElement>(":scope > div").forEach((grid) => {
      const secondaryNames = Array.from(grid.querySelectorAll<HTMLInputElement>('input[type="hidden"][name]')).map((input) => input.name);
      if (!secondaryNames.some((name) => ["bodyType", "transmission", "fuel", "drive"].includes(name))) return;
      grid.classList.add("ac-mobile-secondary-grid");
      const visibleChildren = Array.from(grid.children).filter((child) => !(child as HTMLElement).classList.contains("ac-mobile-market-field"));
      visibleChildren.forEach((child) => (child as HTMLElement).classList.remove("ac-mobile-secondary-span"));
      if (visibleChildren.length % 2 === 1) (visibleChildren.at(-1) as HTMLElement | undefined)?.classList.add("ac-mobile-secondary-span");
    });
  }

  const tray = document.querySelector<HTMLElement>(".ac-filter-more-button");
  if (tray) {
    const main = tray.querySelector<HTMLElement>(":scope > span:first-child");
    if (main) {
      main.classList.add("ac-filter-tray-main");
      const icon = tray.querySelector<SVGElement>(":scope > svg");
      if (icon && !main.contains(icon)) main.prepend(icon);
    }
    const clear = tray.querySelector<HTMLElement>(":scope > .ac-filter-tray-clear");
    if (clear && clear !== tray.lastElementChild) tray.appendChild(clear);
  }
}

function useCatalogFilterDependentUi() {
  useEffect(() => {
    if (catalogFilterDependentUiMounted) return;
    catalogFilterDependentUiMounted = true;
    let frame = 0;
    let facetSignature = "";
    let facets: ContextFacets | null = null;
    let facetController: AbortController | null = null;

    const loadFacets = () => {
      const params = currentCatalogContext(true);
      const signature = params.toString();
      if (signature === facetSignature) {
        applyDependentFacetOptions(facets);
        return;
      }
      facetSignature = signature;
      facetController?.abort();
      if (!hasContext(params)) {
        facets = null;
        applyDependentFacetOptions(null);
        return;
      }
      const controller = new AbortController();
      facetController = controller;
      const request = new URLSearchParams(params);
      request.set("scope", "facets");
      fetch(`/api/catalog/models?${request.toString()}`, { cache: "no-store", signal: controller.signal })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error(`facets_http_${response.status}`)))
        .then((payload) => {
          if (controller.signal.aborted) return;
          facets = payload?.facets || null;
          applyDependentFacetOptions(facets);
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            facets = null;
            applyDependentFacetOptions(null);
          }
        });
    };

    const refresh = () => {
      frame = 0;
      ensureCatalogFilterLayoutPolish();
      applyDependentFacetOptions(facets);
      loadFacets();
    };
    const requestRefresh = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(refresh);
    };
    const delayedRefresh = () => window.setTimeout(requestRefresh, 260);

    refresh();
    const observer = new MutationObserver(requestRefresh);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("input", delayedRefresh, true);
    document.addEventListener("change", delayedRefresh, true);
    document.addEventListener("click", delayedRefresh, true);
    window.addEventListener("popstate", requestRefresh);
    window.addEventListener("resize", requestRefresh);

    return () => {
      catalogFilterDependentUiMounted = false;
      facetController?.abort();
      observer.disconnect();
      document.removeEventListener("input", delayedRefresh, true);
      document.removeEventListener("change", delayedRefresh, true);
      document.removeEventListener("click", delayedRefresh, true);
      window.removeEventListener("popstate", requestRefresh);
      window.removeEventListener("resize", requestRefresh);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);
}

export function VehicleModelSearch({
  value,
  make,
  placeholder = "Любая модель",
  onMakeChange,
  onValueChange,
  onSubmit,
  className = "",
}: {
  value: string;
  make: string;
  placeholder?: string;
  onMakeChange?: (make: string) => void;
  onValueChange?: (model: string) => void;
  onSubmit?: (selection: ModelSelection) => void;
  className?: string;
}) {
  const [query, setQuery] = useState(value || "");
  const [items, setItems] = useState<ModelSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const submitRef = useRef(onSubmit);

  useCatalogFilterDependentUi();
  useLayoutEffect(() => { submitRef.current = onSubmit; }, [onSubmit]);
  useEffect(() => setQuery(value || ""), [value]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  const multipleMakes = String(make || "").split(",").map(clean).filter(Boolean).length > 1;
  const canSearch = Boolean(clean(make) || compact(query).length >= 2);
  useEffect(() => {
    if (!open || !canSearch) {
      setItems([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ q: clean(query), make: clean(make), limit: "50" });
        currentCatalogContext(false).forEach((contextValue, key) => {
          if (key !== "make" && contextValue && !params.has(key)) params.set(key, contextValue);
        });
        const response = await fetch(`/api/catalog/models?${params.toString()}`, { cache: "no-store", signal: controller.signal });
        const payload = response.ok ? await response.json() : { items: [] };
        setItems(Array.isArray(payload?.items) ? payload.items : []);
      } catch {
        if (!controller.signal.aborted) setItems([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 160);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [canSearch, make, open, query]);

  const exact = useMemo(() => {
    const requested = compact(query);
    return items.find((item) => compact(item.model) === requested || (item.aliases || []).some((alias) => compact(alias) === requested));
  }, [items, query]);

  const applySelection = (item: ModelSuggestion) => {
    setQuery(item.model);
    setOpen(false);
    onValueChange?.(item.model);
    onMakeChange?.(item.make);
    const form = root.current?.closest("form");
    const modelInput = input.current;
    const makeInput = form?.querySelector<HTMLInputElement>('input[name="make"]');
    if (modelInput) modelInput.value = item.model;
    if (makeInput) makeInput.value = item.make;
    return form;
  };

  const choose = (item: ModelSuggestion, submit = false) => {
    if (!submit) {
      applySelection(item);
      return;
    }

    let form: HTMLFormElement | null = null;
    flushSync(() => { form = applySelection(item); });
    const selection = { make: item.make, model: item.model };
    window.requestAnimationFrame(() => {
      if (submitRef.current) submitRef.current(selection);
      else form?.requestSubmit();
    });
  };

  return <div ref={root} className={`relative min-w-0 ${open ? "z-[235]" : "z-0"} ${className}`}>
    <input
      ref={input}
      type="search"
      name="model"
      value={query}
      placeholder={placeholder}
      autoComplete="off"
      spellCheck={false}
      onFocus={() => setOpen(true)}
      onChange={(event) => {
        setQuery(event.target.value);
        onValueChange?.(event.target.value);
        setOpen(true);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        const candidate = exact || items[0];
        if (!candidate) return;
        event.preventDefault();
        choose(candidate, true);
      }}
      className="ac-filter-control h-13 w-full rounded-[15px] px-4 text-sm font-black outline-none"
      aria-label="Модель автомобиля"
      aria-expanded={open}
      aria-autocomplete="list"
    />
    {open ? <div className="ac-filter-dropdown absolute left-0 right-0 top-[calc(100%+7px)] overflow-hidden rounded-2xl p-2">
      <div className="ac-hide-scrollbar max-h-72 overflow-y-auto">
        {!canSearch ? <div className="px-3 py-4 text-sm font-bold text-white/45">Введите минимум 2 символа модели</div> : null}
        {canSearch && loading ? <div className="px-3 py-4 text-sm font-bold text-white/45">Ищем модель…</div> : null}
        {canSearch && !loading && items.length ? items.map((item) => <button
          key={item.id || `${item.make}:${item.model}`}
          type="button"
          onClick={() => choose(item)}
          className="ac-filter-option flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm font-bold"
        >
          <span className="min-w-0"><span className="block truncate">{item.model}</span>{!make || multipleMakes ? <span className="block truncate text-[11px] font-semibold opacity-55">{item.make}</span> : null}</span>
          <span className="shrink-0 opacity-45">↵</span>
        </button>) : null}
        {canSearch && !loading && !items.length ? <div className="px-3 py-4 text-sm font-bold text-white/45">Совпадений в каталоге нет</div> : null}
      </div>
    </div> : null}
  </div>;
}
