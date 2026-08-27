import type { Metadata } from "next";
import Link from "next/link";
import { AutocatalogBrandDirectory, type AutocatalogBrandItem } from "@/components/catalog/AutocatalogBrandDirectory";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { readCatalogBrandDirectory } from "@/lib/catalog/catalog-brand-directory";
import { canonicalCatalogBrand } from "@/lib/catalog/brands";
import { readCatalogBrandCounts } from "@/lib/catalog/storage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Автокаталог — марки и модели в продаже | АвтоЦена",
  description: "Автокаталог АвтоЦена: марки и модели, для которых сейчас есть автомобили с рассчитанной стоимостью.",
  alternates: { canonical: "/cars/autocatalog" },
  openGraph: {
    title: "Автокаталог АвтоЦена",
    description: "Марки и модели с актуальными предложениями из семи рынков.",
    url: "/cars/autocatalog",
    type: "website",
  },
};

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export default async function AutocatalogPage() {
  const [brands, live] = await Promise.all([
    readCatalogBrandDirectory(),
    readCatalogBrandCounts().catch(() => ({
      counts: {} as Record<string, number>,
      modelCounts: {} as Record<string, number>,
    })),
  ]);

  const liveCounts = new Map<string, number>();
  const liveModelCounts = new Map<string, number>();
  for (const [rawMake, rawCount] of Object.entries(live.counts || {})) {
    const make = canonicalCatalogBrand(rawMake);
    liveCounts.set(make, (liveCounts.get(make) || 0) + Number(rawCount || 0));
  }
  for (const [rawMake, rawCount] of Object.entries(live.modelCounts || {})) {
    const make = canonicalCatalogBrand(rawMake);
    liveModelCounts.set(make, (liveModelCounts.get(make) || 0) + Number(rawCount || 0));
  }

  const directory: AutocatalogBrandItem[] = brands.map((brand) => ({
    name: brand.name,
    slug: brand.slug,
    aliases: [...new Set((brand.aliases || []).map(clean).filter(Boolean))],
    modelCount: liveModelCounts.get(brand.name) || 0,
    offerCount: liveCounts.get(brand.name) || 0,
  }))
    .filter((brand) => brand.offerCount > 0 && brand.modelCount > 0)
    .sort((left, right) => left.name.localeCompare(right.name, "en"));

  const totalOffers = directory.reduce((sum, brand) => sum + brand.offerCount, 0);
  const totalModels = directory.reduce((sum, brand) => sum + brand.modelCount, 0);

  return <main className="ac-autocatalog-page ac-page-copy min-h-screen overflow-x-hidden bg-[#07080d] text-white">
    <PublicHeader backHref="/cars" backLabel="В каталог" />
    <section className="mx-auto w-full max-w-[1500px] px-4 py-7 md:px-8 md:py-10">
      <nav className="text-xs font-black uppercase tracking-[0.15em] text-[var(--ac-muted)]" aria-label="Хлебные крошки">
        <Link href="/cars" className="hover:text-red-500">Каталог предложений</Link><span className="mx-2">/</span><span>Автокаталог</span>
      </nav>
      <div className="mt-5 grid gap-5 rounded-[2rem] bg-[var(--ac-surface)] p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end md:p-8">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.18em] text-red-500">Только актуальное</div>
          <h1 className="mt-2 text-4xl font-black leading-[.95] tracking-[-0.05em] md:text-7xl">Автокаталог</h1>
          <p className="mt-4 max-w-3xl text-sm font-semibold leading-6 text-[var(--ac-muted)] md:text-base">
            Здесь только марки и модели, у которых сейчас есть автомобили с рассчитанной ценой. Сырые названия источников и пустые справочные карточки скрыты.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-black md:max-w-sm md:justify-end">
          <span className="rounded-full bg-[var(--ac-surface-2)] px-3 py-2">{directory.length.toLocaleString("ru-RU")} марок</span>
          <span className="rounded-full bg-[var(--ac-surface-2)] px-3 py-2">{totalModels.toLocaleString("ru-RU")} моделей</span>
          <span className="rounded-full bg-red-500 px-3 py-2 text-white">{totalOffers.toLocaleString("ru-RU")} автомобилей</span>
        </div>
      </div>
      <AutocatalogBrandDirectory brands={directory} />
    </section>
  </main>;
}
