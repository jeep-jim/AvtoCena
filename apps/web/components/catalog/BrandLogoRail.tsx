"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { CATALOG_BRANDS, canonicalCatalogBrand, catalogBrandSlug } from "@/lib/catalog/brands";

const KNOWN_BRANDS = new Map(CATALOG_BRANDS.map((brand) => [brand.name.toLocaleLowerCase("en-US"), brand.name]));

export function BrandLogoVisual({ brand, className = "" }: { brand: string; className?: string }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [failed, setFailed] = useState(false);
  const slug = catalogBrandSlug(brand);

  useEffect(() => setFailed(false), [brand, theme]);
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setTheme(root.dataset.theme === "dark" ? "dark" : "light");
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  if (failed) {
    return <span className={`flex h-10 w-[76px] items-center justify-center text-center text-[12px] font-black leading-[1.05] tracking-[-0.035em] text-[var(--ac-text)] ${className}`}>{brand}</span>;
  }

  return <img
    src={`/brand-logos/drom/${theme}/${slug}.png`}
    alt={`Логотип ${brand}`}
    loading="lazy"
    decoding="async"
    draggable={false}
    onError={() => setFailed(true)}
    className={`h-10 w-[76px] select-none bg-transparent object-contain ${className}`}
  />;
}

function BrandTile({ brand, onNavigate }: { brand: string; onNavigate?: () => void }) {
  return <Link
    href={`/cars/brand/${catalogBrandSlug(brand)}`}
    onClick={onNavigate}
    className="flex h-[78px] min-w-[94px] shrink-0 touch-manipulation select-none flex-col items-center justify-center gap-1.5 px-1.5 transition md:hover:-translate-y-0.5"
    title={`Автомобили ${brand} под заказ`}
  >
    <BrandLogoVisual brand={brand} />
    <span className="pointer-events-none max-w-[92px] truncate text-center text-[11px] font-black text-[var(--ac-text)]">{brand}</span>
  </Link>;
}

export function BrandLogoRail({ brands }: { brands: string[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const pointer = useRef<{ x: number; moved: boolean } | null>(null);
  const activeBrands = useMemo(() => {
    const map = new Map<string, string>();
    for (const value of brands) {
      const canonical = canonicalCatalogBrand(value);
      const known = KNOWN_BRANDS.get(canonical.toLocaleLowerCase("en-US"));
      if (known) map.set(known.toLocaleLowerCase("en-US"), known);
    }
    return [...map.values()].sort((a, b) => a.localeCompare(b, "ru"));
  }, [brands]);
  const allBrands = useMemo(() => CATALOG_BRANDS.map((brand) => brand.name), []);
  const orderedBrands = useMemo(() => {
    const active = new Set(activeBrands.map((brand) => brand.toLocaleLowerCase("en-US")));
    return [...activeBrands, ...allBrands.filter((brand) => !active.has(brand.toLocaleLowerCase("en-US")))];
  }, [activeBrands, allBrands]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru-RU");
    return normalized ? allBrands.filter((brand) => brand.toLocaleLowerCase("ru-RU").includes(normalized)) : allBrands;
  }, [allBrands, query]);

  useEffect(() => {
    if (!open) return;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", escape);
    return () => { document.body.style.overflow = old; window.removeEventListener("keydown", escape); };
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  return <>
    <section className="ac-brand-rail relative mt-5 rounded-[1.6rem] p-3 pr-12 md:p-4 md:pr-16" aria-label="Марки автомобилей">
      <div
        className="ac-hide-scrollbar flex min-w-0 touch-pan-x items-center gap-1 overflow-x-auto overscroll-x-contain scroll-smooth pb-1"
        style={{ WebkitOverflowScrolling: "touch" }}
        onPointerDown={(event) => { pointer.current = { x: event.clientX, moved: false }; }}
        onPointerMove={(event) => { if (pointer.current && Math.abs(event.clientX - pointer.current.x) > 7) pointer.current.moved = true; }}
        onPointerUp={() => { window.setTimeout(() => { pointer.current = null; }, 0); }}
        onPointerCancel={() => { pointer.current = null; }}
        onClickCapture={(event) => {
          if (!pointer.current?.moved) return;
          event.preventDefault();
          event.stopPropagation();
          pointer.current = null;
        }}
      >
        {orderedBrands.map((brand) => <BrandTile key={brand.toLocaleLowerCase("en-US")} brand={brand} />)}
      </div>
      <button type="button" onClick={() => setOpen(true)} className="absolute right-2 top-1/2 flex h-12 w-9 -translate-y-1/2 items-center justify-center rounded-xl bg-[var(--ac-surface-2)] text-xl font-black text-red-500" aria-label="Показать все марки">›</button>
    </section>

    {open ? <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/80 p-2.5 backdrop-blur-sm md:p-5" onClick={close} role="dialog" aria-modal="true" aria-label="Все марки автомобилей">
      <div className="ac-brand-rail ac-hide-scrollbar max-h-[92dvh] w-full max-w-6xl overflow-y-auto rounded-[1.8rem] p-4 md:p-7" onClick={(event) => event.stopPropagation()}>
        <div className="sticky -top-4 z-10 bg-[var(--ac-surface)] pb-4 pt-1 md:-top-7 md:pt-2">
          <div className="flex items-center justify-between gap-4"><h2 className="text-2xl font-black md:text-4xl">Все марки</h2><button type="button" onClick={close} className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--ac-surface-2)] text-2xl font-black">×</button></div>
          <input value={query} onChange={(event) => setQuery(event.target.value)} autoFocus placeholder="Найти марку" className="ac-filter-search mt-4 h-12 w-full rounded-2xl px-4 text-sm font-bold outline-none" />
        </div>
        <div className="grid grid-cols-2 gap-x-1 gap-y-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-7">
          {filtered.map((brand) => <BrandTile key={brand} brand={brand} onNavigate={close} />)}
        </div>
        {!filtered.length ? <div className="py-12 text-center font-bold text-[var(--ac-muted)]">Марка не найдена</div> : null}
      </div>
    </div> : null}
  </>;
}
