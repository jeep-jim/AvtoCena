"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CATALOG_BRANDS, canonicalCatalogBrand, catalogBrandLogoSlug, catalogBrandSlug } from "@/lib/catalog/brands";

function GenericBrandIcon() {
  return <svg width="58" height="34" viewBox="0 0 58 34" fill="none" aria-hidden="true"><path d="M7 22.5L11.5 14H41.5L49 22.5V27H45.5M12.5 27H7V22.5H51V27H45.5M17 27H41" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="15" cy="27" r="4" stroke="currentColor" strokeWidth="2.2"/><circle cx="43" cy="27" r="4" stroke="currentColor" strokeWidth="2.2"/><path d="M15 14L20 8H35L41.5 14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

export function BrandLogoVisual({ brand, className = "" }: { brand: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const slug = catalogBrandLogoSlug(brand);
  if (!slug || failed) return <span className={`flex h-10 w-16 items-center justify-center text-[var(--ac-muted)] ${className}`}><GenericBrandIcon /></span>;
  return <img src={`https://cdn.simpleicons.org/${slug}`} alt={brand} loading="lazy" onError={() => setFailed(true)} className={`h-10 w-16 object-contain ${className}`} />;
}

function BrandTile({ brand, onNavigate }: { brand: string; onNavigate?: () => void }) {
  return <Link href={`/cars/brand/${catalogBrandSlug(brand)}`} onClick={onNavigate} className="flex h-[78px] min-w-[96px] flex-col items-center justify-center gap-1.5 px-2 transition hover:-translate-y-0.5" title={`Автомобили ${brand} под заказ`}>
    <BrandLogoVisual brand={brand} />
    <span className="max-w-[92px] truncate text-center text-[11px] font-black text-[var(--ac-text)]">{brand}</span>
  </Link>;
}

export function BrandLogoRail({ brands }: { brands: string[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const activeBrands = useMemo(() => {
    const map = new Map<string, string>();
    for (const value of brands) {
      const canonical = canonicalCatalogBrand(value);
      if (canonical) map.set(canonical.toLocaleLowerCase("en-US"), canonical);
    }
    return [...map.values()].sort((a, b) => a.localeCompare(b, "ru"));
  }, [brands]);
  const allBrands = useMemo(() => CATALOG_BRANDS.map((brand) => brand.name), []);
  const visible = activeBrands.slice(0, 16);
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

  return <>
    <section className="ac-brand-rail mt-5 rounded-[1.6rem] p-3 md:p-4" aria-label="Марки автомобилей">
      <div className="flex min-w-0 items-center gap-2">
        <div className="ac-hide-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scroll-smooth pb-1">
          {visible.map((brand) => <BrandTile key={brand.toLocaleLowerCase("en-US")} brand={brand} />)}
        </div>
        <button type="button" onClick={() => setOpen(true)} className="sticky right-0 flex h-[78px] min-w-[68px] shrink-0 items-center justify-center rounded-2xl bg-[var(--ac-surface-2)] text-3xl font-black text-red-500 shadow-[-16px_0_24px_var(--ac-bg)]" aria-label="Показать все марки">→</button>
      </div>
    </section>
    {open ? <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/80 p-3 md:p-5" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Все марки автомобилей">
      <div className="ac-brand-rail ac-hide-scrollbar max-h-[90dvh] w-full max-w-6xl overflow-y-auto rounded-[1.8rem] p-4 md:p-7" onClick={(event) => event.stopPropagation()}>
        <div className="sticky -top-4 z-10 bg-[var(--ac-surface)] pb-4 pt-1 md:-top-7 md:pt-2">
          <div className="flex items-center justify-between gap-4"><h2 className="text-2xl font-black md:text-4xl">Все марки</h2><button type="button" onClick={() => setOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--ac-surface-2)] text-2xl font-black">×</button></div>
          <input value={query} onChange={(event) => setQuery(event.target.value)} autoFocus placeholder="Найти марку" className="ac-filter-search mt-4 h-12 w-full rounded-2xl px-4 text-sm font-bold outline-none" />
        </div>
        <div className="grid grid-cols-2 gap-x-2 gap-y-3 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-7">
          {filtered.map((brand) => <BrandTile key={brand} brand={brand} onNavigate={() => setOpen(false)} />)}
        </div>
        {!filtered.length ? <div className="py-12 text-center font-bold text-[var(--ac-muted)]">Марка не найдена</div> : null}
      </div>
    </div> : null}
  </>;
}
