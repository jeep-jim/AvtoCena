"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const LOGO_SLUGS: Record<string, string> = {
  Acura: "acura", "Alfa Romeo": "alfaromeo", AstonMartin: "astonmartin", Audi: "audi", Aito: "aito",
  Bentley: "bentley", BMW: "bmw", BYD: "byd", Cadillac: "cadillac", Changan: "changan",
  Chevrolet: "chevrolet", Chery: "chery", Chrysler: "chrysler", Citroen: "citroen", Cupra: "cupra",
  Daihatsu: "daihatsu", Dodge: "dodge", Ferrari: "ferrari", Fiat: "fiat", Ford: "ford",
  Genesis: "genesis", Geely: "geely", GMC: "gmc", Honda: "honda", Hyundai: "hyundai",
  Infiniti: "infiniti", Isuzu: "isuzu", Jaguar: "jaguar", Jeep: "jeep", Kia: "kia",
  Lamborghini: "lamborghini", Lexus: "lexus", Lotus: "lotus", Maserati: "maserati", Mazda: "mazda",
  "Mercedes-Benz": "mercedes", MINI: "mini", Mitsubishi: "mitsubishi", Nissan: "nissan", Nio: "nio",
  Opel: "opel", Peugeot: "peugeot", Polestar: "polestar", Porsche: "porsche", Renault: "renault",
  RollsRoyce: "rollsroyce", SEAT: "seat", Skoda: "skoda", Subaru: "subaru", Suzuki: "suzuki",
  Tesla: "tesla", Toyota: "toyota", Volkswagen: "volkswagen", Volvo: "volvo", XPeng: "xpeng",
};

function normalizedBrand(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function logoSlug(brand: string) {
  const exact = LOGO_SLUGS[brand];
  if (exact) return exact;
  const compact = brand.replace(/[\s_.-]+/g, "");
  return LOGO_SLUGS[compact] || compact.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function BrandLogo({ brand }: { brand: string }) {
  const [failed, setFailed] = useState(false);
  const slug = logoSlug(brand);
  if (failed || !slug) {
    return <span className="text-xl font-black text-red-500">{brand.slice(0, 2).toUpperCase()}</span>;
  }
  return <img src={`https://cdn.simpleicons.org/${slug}`} alt={brand} loading="lazy" onError={() => setFailed(true)} className="h-10 w-16 object-contain" />;
}

function BrandTile({ brand, onNavigate }: { brand: string; onNavigate?: () => void }) {
  return <Link href={`/cars?make=${encodeURIComponent(brand)}`} onClick={onNavigate} className="ac-brand-logo-tile flex h-[82px] min-w-[108px] flex-col items-center justify-center gap-2 rounded-2xl px-3 transition hover:-translate-y-0.5">
    <BrandLogo brand={brand} />
    <span className="max-w-[94px] truncate text-[11px] font-black text-[var(--ac-text)]">{brand}</span>
  </Link>;
}

export function BrandLogoRail({ brands }: { brands: string[] }) {
  const [open, setOpen] = useState(false);
  const unique = useMemo(() => [...new Set(brands.map(normalizedBrand).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru")), [brands]);
  const visible = unique.slice(0, 14);

  useEffect(() => {
    if (!open) return;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", escape);
    return () => { document.body.style.overflow = old; window.removeEventListener("keydown", escape); };
  }, [open]);

  if (!unique.length) return null;

  return <>
    <section className="ac-brand-rail mt-5 rounded-[1.6rem] p-3 md:p-4" aria-label="Марки автомобилей">
      <div className="ac-hide-scrollbar flex items-center gap-3 overflow-x-auto pb-1">
        {visible.map((brand) => <BrandTile key={brand} brand={brand} />)}
        <button type="button" onClick={() => setOpen(true)} className="ac-brand-logo-tile flex h-[82px] min-w-[82px] items-center justify-center rounded-2xl text-3xl font-black text-red-500" aria-label="Показать все марки">→</button>
      </div>
    </section>
    {open ? <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/80 p-4" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Все марки автомобилей">
      <div className="ac-brand-rail ac-hide-scrollbar max-h-[88dvh] w-full max-w-6xl overflow-y-auto rounded-[1.8rem] p-5 md:p-7" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-4"><h2 className="text-2xl font-black md:text-4xl">Все марки</h2><button type="button" onClick={() => setOpen(false)} className="ac-brand-logo-tile flex h-11 w-11 items-center justify-center rounded-xl text-2xl font-black">×</button></div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-7">
          {unique.map((brand) => <BrandTile key={brand} brand={brand} onNavigate={() => setOpen(false)} />)}
        </div>
      </div>
    </div> : null}
  </>;
}
