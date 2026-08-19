"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { CATALOG_BRANDS, canonicalCatalogBrand, catalogBrandSlug } from "@/lib/catalog/brands";

const BRAND_COUNT_FORMATTER = new Intl.NumberFormat("ru-RU");
const BRAND_COUNT_CACHE_MS = 30_000;
const BRAND_COUNT_REQUESTS = new Map<string, { at: number; promise: Promise<Record<string, number>> }>();

function loadBrandCounts(query: string) {
  const key = query || "__all__";
  const now = Date.now();
  const cached = BRAND_COUNT_REQUESTS.get(key);
  if (cached && now - cached.at < BRAND_COUNT_CACHE_MS) return cached.promise;
  const suffix = query ? `?${query}` : "";
  const promise = fetch(`/api/catalog/brand-counts${suffix}`, { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Brand counts request failed: ${response.status}`);
      const payload = await response.json();
      return payload?.counts && typeof payload.counts === "object" ? payload.counts as Record<string, number> : {};
    })
    .catch((error) => {
      BRAND_COUNT_REQUESTS.delete(key);
      throw error;
    });
  BRAND_COUNT_REQUESTS.set(key, { at: now, promise });
  return promise;
}

export function BrandLogoVisual({ brand, className = "" }: { brand: string; className?: string }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [sourceIndex, setSourceIndex] = useState(0);
  const slug = catalogBrandSlug(brand);

  useEffect(() => setSourceIndex(0), [brand, theme]);
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setTheme(root.dataset.theme === "dark" ? "dark" : "light");
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  const sources = [
    `/brand-logos/drom/${theme}/${slug}.png`,
    `/api/catalog/brand-logo/${encodeURIComponent(slug)}?theme=${theme}`,
    `/favicon-${theme}.svg`,
  ];

  return <img
    src={sources[Math.min(sourceIndex, sources.length - 1)]}
    alt={sourceIndex < 2 ? `Логотип ${brand}` : "АвтоЦена"}
    loading="lazy"
    decoding="async"
    draggable={false}
    onError={() => setSourceIndex((current) => Math.min(sources.length - 1, current + 1))}
    className={`h-10 w-[76px] select-none bg-transparent object-contain ${className}`}
  />;
}

function BrandTile({ brand, href, onClick }: { brand: string; href: string; onClick?: (event: MouseEvent<HTMLAnchorElement>) => void }) {
  return <Link
    href={href}
    onClick={onClick}
    className="flex h-[78px] min-w-[94px] shrink-0 touch-manipulation select-none flex-col items-center justify-center gap-1.5 px-1.5 transition md:hover:-translate-y-0.5"
    title={`Автомобили ${brand} под заказ`}
  >
    <BrandLogoVisual brand={brand} />
    <span className="pointer-events-none max-w-[92px] truncate text-center text-[11px] font-black text-[var(--ac-text)]">{brand}</span>
  </Link>;
}

function BrandDirectoryTile({
  brand,
  href,
  countLabel,
  selected = false,
  onClick,
  onPointerEnter,
}: {
  brand: string;
  href: string;
  countLabel: string;
  selected?: boolean;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  onPointerEnter?: () => void;
}) {
  return <Link
    href={href}
    prefetch={false}
    onClick={onClick}
    onPointerEnter={onPointerEnter}
    className={`group flex min-h-[62px] min-w-0 items-center gap-3 rounded-2xl px-3 py-2 transition hover:bg-[var(--ac-surface-2)] focus-visible:bg-[var(--ac-surface-2)] focus-visible:outline-none ${selected ? "bg-[var(--ac-surface-2)]" : ""}`}
    title={`Автомобили ${brand} под заказ`}
  >
    <BrandLogoVisual brand={brand} className="h-9 w-[64px] shrink-0" />
    <span className="min-w-0 flex-1 truncate text-sm font-black text-[var(--ac-text)] md:text-[15px]">
      {brand}<span className="font-bold text-[var(--ac-muted)]"> · {countLabel}</span>
    </span>
    {selected ? <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-500 text-[12px] font-black text-white" style={{ color: "#fff", WebkitTextFillColor: "#fff" }} aria-label="Выбрано">✓</span> : null}
  </Link>;
}

export function BrandLogoRail({
  brands,
  resultCount,
  directoryMode = false,
  showSearch = false,
}: {
  brands: string[];
  resultCount?: number;
  directoryMode?: boolean;
  showSearch?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsText = searchParams.toString();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [brandCounts, setBrandCounts] = useState<Record<string, number>>({});
  const [countStatus, setCountStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const railRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; startX: number; startScrollLeft: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const homeBrandDirectory = directoryMode || pathname === "/";
  const suppliedBrands = useMemo(() => {
    const map = new Map<string, string>();
    for (const value of brands) {
      const canonical = canonicalCatalogBrand(value);
      if (canonical) map.set(canonical.toLocaleLowerCase("en-US"), canonical);
    }
    return [...map.values()].sort((a, b) => a.localeCompare(b, "ru"));
  }, [brands]);
  const knownBrands = useMemo(() => new Map(
    [...CATALOG_BRANDS.map((brand) => brand.name), ...suppliedBrands]
      .map((brand) => [brand.toLocaleLowerCase("en-US"), brand] as const),
  ), [suppliedBrands]);
  const selectedBrands = useMemo(() => {
    if (homeBrandDirectory) return [] as string[];
    const raw = searchParams.get("make") || searchParams.get("brand") || "";
    const map = new Map<string, string>();
    for (const value of raw.split(",").map((item) => canonicalCatalogBrand(item.trim())).filter(Boolean)) {
      const known = knownBrands.get(value.toLocaleLowerCase("en-US"));
      if (known) map.set(known.toLocaleLowerCase("en-US"), known);
    }
    return [...map.values()];
  }, [homeBrandDirectory, knownBrands, searchParamsText]);
  const selectedBrandKeys = useMemo(() => new Set(selectedBrands.map((brand) => brand.toLocaleLowerCase("en-US"))), [selectedBrands]);
  const countQuery = useMemo(() => {
    if (homeBrandDirectory) return "";
    const params = new URLSearchParams(searchParamsText);
    for (const key of ["make", "brand", "model", "page", "sort", "advanced"]) params.delete(key);
    return params.toString();
  }, [homeBrandDirectory, searchParamsText]);
  const normalizedCounts = useMemo(() => {
    const result = new Map<string, { brand: string; count: number }>();
    for (const [brand, value] of Object.entries(brandCounts)) {
      const canonical = canonicalCatalogBrand(brand);
      const known = knownBrands.get(canonical.toLocaleLowerCase("en-US"));
      const count = Number(value);
      if (known && Number.isFinite(count) && count >= 0) result.set(known.toLocaleLowerCase("en-US"), { brand: known, count });
    }
    return result;
  }, [brandCounts, knownBrands]);
  const activeBrands = useMemo(() => {
    if (directoryMode) return suppliedBrands;
    // Once live counts arrive, they become the source of truth on both /cars and
    // the homepage. This removes old knowledge-only brands with no live cars.
    if (countStatus === "ready") {
      return [...normalizedCounts.values()]
        .filter((item) => item.count > 0)
        .map((item) => item.brand)
        .sort((a, b) => a.localeCompare(b, "ru"));
    }
    const map = new Map<string, string>();
    for (const value of brands) {
      const canonical = canonicalCatalogBrand(value);
      const known = knownBrands.get(canonical.toLocaleLowerCase("en-US"));
      if (known) map.set(known.toLocaleLowerCase("en-US"), known);
    }
    return [...map.values()].sort((a, b) => a.localeCompare(b, "ru"));
  }, [brands, countStatus, directoryMode, knownBrands, normalizedCounts, suppliedBrands]);
  const orderedBrands = activeBrands;
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru-RU");
    return normalized ? activeBrands.filter((brand) => brand.toLocaleLowerCase("ru-RU").includes(normalized)) : activeBrands;
  }, [activeBrands, query]);
  const railBrands = showSearch && query.trim() ? filtered : orderedBrands;

  useEffect(() => {
    if (!open) return;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", escape);
    return () => { document.body.style.overflow = old; window.removeEventListener("keydown", escape); };
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    setCountStatus("loading");
    loadBrandCounts(countQuery)
      .then((counts) => {
        if (cancelled) return;
        setBrandCounts(counts);
        setCountStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setBrandCounts({});
        setCountStatus("error");
      });
    return () => { cancelled = true; };
  }, [countQuery]);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const onWheel = (event: globalThis.WheelEvent) => {
      const maxScroll = Math.max(0, rail.scrollWidth - rail.clientWidth);
      if (maxScroll <= 2) return;
      const dominant = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (Math.abs(dominant) < 0.5) return;
      // While the pointer is over the brand rail, the wheel belongs only to the
      // rail. Do not let the page drift vertically at the same time.
      event.preventDefault();
      event.stopPropagation();
      rail.scrollLeft = Math.max(0, Math.min(maxScroll, rail.scrollLeft + dominant));
    };
    rail.addEventListener("wheel", onWheel, { passive: false });
    return () => rail.removeEventListener("wheel", onWheel);
  }, [orderedBrands.length]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const setCatalogBrands = (nextBrands: string[]) => {
    const params = new URLSearchParams(window.location.search);
    const ordered = [...new Set(nextBrands)].sort((a, b) => a.localeCompare(b, "ru"));
    if (ordered.length) params.set("make", ordered.join(",")); else params.delete("make");
    params.delete("brand");
    params.delete("model");
    params.delete("page");
    const queryString = params.toString();
    router.replace(queryString ? `/cars?${queryString}` : "/cars", { scroll: false });
  };

  const clearSelectedBrands = () => setCatalogBrands([]);

  const hrefForBrand = (brand: string) => homeBrandDirectory
    ? `/cars/brand/${catalogBrandSlug(brand)}`
    : `/cars?make=${encodeURIComponent(brand)}`;

  const handleBrandClick = (brand: string, closeAfter = false) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (homeBrandDirectory) {
      if (closeAfter) close();
      return;
    }

    event.preventDefault();
    const key = brand.toLocaleLowerCase("en-US");
    const next = selectedBrandKeys.has(key)
      ? selectedBrands.filter((item) => item.toLocaleLowerCase("en-US") !== key)
      : [...selectedBrands, brand];
    setCatalogBrands(next);
  };

  const countLabelForBrand = (brand: string) => {
    if (countStatus === "loading" || countStatus === "idle") return "…";
    if (countStatus === "error") return "—";
    const count = normalizedCounts.get(brand.toLocaleLowerCase("en-US"))?.count || 0;
    return BRAND_COUNT_FORMATTER.format(count);
  };

  const beginMouseDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    const rail = event.currentTarget;
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startScrollLeft: rail.scrollLeft, moved: false };
    suppressClick.current = false;
  };
  const moveMouseDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const dx = event.clientX - state.startX;
    if (Math.abs(dx) > 4 && !state.moved) {
      state.moved = true;
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.classList.add("is-dragging");
    }
    if (!state.moved) return;
    event.preventDefault();
    event.currentTarget.scrollLeft = state.startScrollLeft - dx;
  };
  const endMouseDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    suppressClick.current = state.moved;
    drag.current = null;
    event.currentTarget.classList.remove("is-dragging");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    window.setTimeout(() => { suppressClick.current = false; }, 0);
  };

  return <>
    {showSearch ? <label className="mt-5 flex h-14 w-full items-center gap-3 rounded-2xl bg-[var(--ac-surface)] px-4 text-[var(--ac-muted)] focus-within:ring-2 focus-within:ring-red-500/35">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8" stroke="currentColor" strokeWidth="1.9" /><path d="m16 16 4.3 4.3" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Найти марку"
        className="h-full min-w-0 flex-1 bg-transparent text-sm font-bold text-[var(--ac-text)] outline-none placeholder:text-[var(--ac-muted)]"
        aria-label="Найти марку автомобиля"
      />
      {query ? <button type="button" onClick={() => setQuery("")} className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--ac-surface-2)] text-lg font-bold" aria-label="Очистить поиск">×</button> : null}
    </label> : null}
    <section className="ac-brand-rail relative mt-5 rounded-[1.6rem] p-3 pr-12 md:p-4 md:pr-16" aria-label="Марки автомобилей">
      <div
        ref={railRef}
        className="ac-hide-scrollbar flex min-w-0 cursor-grab touch-pan-x items-center gap-1 overflow-x-auto overscroll-x-contain scroll-smooth pb-1 [&.is-dragging]:cursor-grabbing [&.is-dragging]:scroll-auto"
        style={{ WebkitOverflowScrolling: "touch" }}
        onPointerDown={beginMouseDrag}
        onPointerMove={moveMouseDrag}
        onPointerUp={endMouseDrag}
        onPointerCancel={endMouseDrag}
        onClickCapture={(event) => {
          if (!suppressClick.current) return;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {railBrands.map((brand) => <BrandTile key={brand.toLocaleLowerCase("en-US")} brand={brand} href={hrefForBrand(brand)} onClick={handleBrandClick(brand)} />)}
        {!railBrands.length ? <div className="px-4 py-6 text-sm font-bold text-[var(--ac-muted)]">Марка не найдена</div> : null}
      </div>
      <button type="button" onClick={() => setOpen(true)} className="absolute right-2 top-1/2 flex h-12 w-9 -translate-y-1/2 items-center justify-center rounded-xl bg-[var(--ac-surface-2)] text-xl font-black text-red-500" aria-label="Показать все марки">›</button>
    </section>

    {open ? <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/80 p-2.5 backdrop-blur-sm md:p-5" onClick={close} role="dialog" aria-modal="true" aria-label="Все марки автомобилей">
      <div className="ac-brand-rail ac-hide-scrollbar max-h-[92dvh] w-full max-w-6xl overflow-y-auto rounded-[1.8rem] p-4 md:p-7" onClick={(event) => event.stopPropagation()}>
        <div className="sticky -top-4 z-10 bg-[var(--ac-surface)] pb-4 pt-1 md:-top-7 md:pt-2">
          <div className="flex items-center justify-between gap-4"><h2 className="text-2xl font-black md:text-4xl">Все марки</h2><div className="flex items-center gap-3">{!homeBrandDirectory && selectedBrands.length ? <button type="button" onClick={clearSelectedBrands} className="mr-7 min-h-10 rounded-xl border border-red-500/45 px-4 text-sm font-black text-red-500 md:mr-14">Очистить</button> : null}<button type="button" onClick={close} className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--ac-surface-2)] text-2xl font-black">×</button></div></div>
          <input value={query} onChange={(event) => setQuery(event.target.value)} autoFocus placeholder="Найти марку" className="ac-filter-search mt-4 h-12 w-full rounded-2xl px-4 text-sm font-bold outline-none" />
        </div>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3 lg:gap-x-3 lg:gap-y-1.5">
          {filtered.map((brand) => <BrandDirectoryTile key={brand} brand={brand} href={hrefForBrand(brand)} countLabel={countLabelForBrand(brand)} selected={!homeBrandDirectory && selectedBrandKeys.has(brand.toLocaleLowerCase("en-US"))} onPointerEnter={homeBrandDirectory ? () => router.prefetch(hrefForBrand(brand)) : undefined} onClick={handleBrandClick(brand, true)} />)}
        </div>
        {!filtered.length ? <div className="py-12 text-center font-bold text-[var(--ac-muted)]">Марка не найдена</div> : null}
      </div>
    </div> : null}
  </>;
}
