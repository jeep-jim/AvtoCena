"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CATALOG_BRANDS, canonicalCatalogBrand, catalogBrandLogoSlug, catalogBrandSlug } from "@/lib/catalog/brands";

const CAR_LOGO_BASE = "https://cdn.jsdelivr.net/npm/car-brand-logos@1.0.0";
const CAR_LOGO_FILES: Record<string, string> = {
  "Acura": "acura-logo.svg", "Alfa Romeo": "alfa-romeo-logo.svg", "Aston Martin": "aston-martin-logo.svg", "Audi": "audi-logo.svg",
  "Avatr": "avatr-logo.svg", "BAIC": "baic-logo.svg", "Bentley": "bentley-logo.svg", "BMW": "bmw-logo.svg", "Buick": "buick-logo.png",
  "BYD": "byd-logo.svg", "Cadillac": "cadillac-logo.png", "Changan": "changan-logo.png", "Chery": "chery-logo.png", "Chevrolet": "chevrolet-logo.png",
  "Chrysler": "chrysler-logo.svg", "Citroen": "citroen-logo.svg", "Cupra": "cupra-logo.svg", "Daihatsu": "daihatsu-logo.svg", "Denza": "denza-logo.svg",
  "Dodge": "dodge-logo.png", "Dongfeng": "dongfeng-logo.png", "Ferrari": "ferrari-logo.svg", "Fiat": "fiat-logo.svg", "Ford": "ford-logo.png",
  "Geely": "geely-logo.svg", "Genesis": "genesis-logo.svg", "GMC": "gmc-logo.png", "Great Wall": "great-wall-logo.png", "Haval": "haval-logo.png",
  "Honda": "honda-logo.png", "Hongqi": "hongqi-logo.png", "Hyundai": "hyundai-logo.svg", "Infiniti": "infiniti-logo.svg", "Isuzu": "isuzu-logo.svg",
  "JAC": "jac-logo.png", "Jaguar": "jaguar-logo.svg", "Jeep": "jeep-logo.svg", "Jetour": "jetour-logo.svg", "KGM": "kgm-logo.svg",
  "Kia": "kia-logo.svg", "Lada": "lada-logo.svg", "Lamborghini": "lamborghini-logo.png", "Land Rover": "land-rover-logo.svg", "Leapmotor": "leapmotor-logo.png",
  "Lexus": "lexus-logo.png", "Lincoln": "lincoln-logo.svg", "Lotus": "lotus-logo.svg", "Maserati": "maserati-logo.png", "Mazda": "mazda-logo.svg",
  "McLaren": "mclaren-logo.svg", "Mercedes-Benz": "mercedes-benz-logo.svg", "MG": "mg-logo.png", "MINI": "mini-logo.svg", "Mitsubishi": "mitsubishi-logo.svg",
  "Nio": "nio-logo.png", "Nissan": "nissan-logo.svg", "Omoda": "omoda-logo.png", "Opel": "opel-logo.svg", "Peugeot": "peugeot-logo.svg",
  "Polestar": "polestar-logo.png", "Porsche": "porsche-logo.svg", "RAM": "ram-logo.svg", "Renault": "renault-logo.svg", "Rolls-Royce": "rolls-royce-logo.svg",
  "SEAT": "seat-logo.svg", "Skoda": "skoda-logo.svg", "Smart": "smart-logo.png", "Subaru": "subaru-logo.png", "Suzuki": "suzuki-logo.svg",
  "Tesla": "tesla-logo.svg", "Toyota": "toyota-logo.svg", "Volkswagen": "volkswagen-logo.svg", "Volvo": "volvo-logo.svg", "XPeng": "xpeng-logo.png",
  "Zeekr": "zeekr-logo.png",
};

function logoSources(brand: string) {
  const sources: string[] = [];
  const file = CAR_LOGO_FILES[brand];
  if (file) sources.push(`${CAR_LOGO_BASE}/${file}`);
  const simpleSlug = catalogBrandLogoSlug(brand);
  if (simpleSlug) sources.push(`https://cdn.jsdelivr.net/npm/simple-icons@v16/icons/${simpleSlug}.svg`);
  return [...new Set(sources)];
}

export function BrandLogoVisual({ brand, className = "" }: { brand: string; className?: string }) {
  const sources = useMemo(() => logoSources(brand), [brand]);
  const [sourceIndex, setSourceIndex] = useState(0);
  useEffect(() => setSourceIndex(0), [brand]);

  if (sourceIndex >= sources.length) {
    return <span className={`flex h-10 w-[76px] items-center justify-center text-center text-[12px] font-black leading-[1.05] tracking-[-0.035em] text-[var(--ac-text)] ${className}`}>{brand}</span>;
  }
  return <img src={sources[sourceIndex]} alt={`Логотип ${brand}`} loading="lazy" onError={() => setSourceIndex((current) => current + 1)} className={`h-10 w-[76px] object-contain ${className}`} />;
}

function BrandTile({ brand, onNavigate }: { brand: string; onNavigate?: () => void }) {
  return <Link href={`/cars/brand/${catalogBrandSlug(brand)}`} onClick={onNavigate} className="flex h-[78px] min-w-[94px] flex-col items-center justify-center gap-1.5 px-1.5 transition hover:-translate-y-0.5" title={`Автомобили ${brand} под заказ`}>
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
    <section className="ac-brand-rail relative mt-5 rounded-[1.6rem] p-3 pr-12 md:p-4 md:pr-16" aria-label="Марки автомобилей">
      <div className="ac-hide-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto scroll-smooth pb-1">
        {visible.map((brand) => <BrandTile key={brand.toLocaleLowerCase("en-US")} brand={brand} />)}
      </div>
      <button type="button" onClick={() => setOpen(true)} className="absolute right-2 top-1/2 flex h-12 w-9 -translate-y-1/2 items-center justify-center rounded-xl bg-[var(--ac-surface-2)] text-xl font-black text-red-500" aria-label="Показать все марки">›</button>
    </section>
    {open ? <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/80 p-2.5 md:p-5" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Все марки автомобилей">
      <div className="ac-brand-rail ac-hide-scrollbar max-h-[92dvh] w-full max-w-6xl overflow-y-auto rounded-[1.8rem] p-4 md:p-7" onClick={(event) => event.stopPropagation()}>
        <div className="sticky -top-4 z-10 bg-[var(--ac-surface)] pb-4 pt-1 md:-top-7 md:pt-2">
          <div className="flex items-center justify-between gap-4"><h2 className="text-2xl font-black md:text-4xl">Все марки</h2><button type="button" onClick={() => setOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--ac-surface-2)] text-2xl font-black">×</button></div>
          <input value={query} onChange={(event) => setQuery(event.target.value)} autoFocus placeholder="Найти марку" className="ac-filter-search mt-4 h-12 w-full rounded-2xl px-4 text-sm font-bold outline-none" />
        </div>
        <div className="grid grid-cols-2 gap-x-1 gap-y-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-7">
          {filtered.map((brand) => <BrandTile key={brand} brand={brand} onNavigate={() => setOpen(false)} />)}
        </div>
        {!filtered.length ? <div className="py-12 text-center font-bold text-[var(--ac-muted)]">Марка не найдена</div> : null}
      </div>
    </div> : null}
  </>;
}
