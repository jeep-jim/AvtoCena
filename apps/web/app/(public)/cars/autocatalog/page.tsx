import type { Metadata } from "next";
import Link from "next/link";
import { AutocatalogBrandDirectory, type AutocatalogBrandItem } from "@/components/catalog/AutocatalogBrandDirectory";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { readCatalogBrandDirectory } from "@/lib/catalog/catalog-brand-directory";
import { canonicalCatalogBrand } from "@/lib/catalog/brands";
import { readEncyclopediaKnowledgeModels, readEncyclopediaStats } from "@/lib/catalog/encyclopedia";
import { readCatalogBrandCounts } from "@/lib/catalog/storage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Автокаталог — марки, модели и характеристики | АвтоЦена",
  description: "Автокаталог АвтоЦена: марки по алфавиту, модели, поколения, модификации и проверенные технические характеристики автомобилей.",
  alternates: { canonical: "/cars/autocatalog" },
  openGraph: {
    title: "Автокаталог АвтоЦена",
    description: "Марки, модели и проверенные технические характеристики в понятной базе автомобилей.",
    url: "/cars/autocatalog",
    type: "website",
  },
};

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export default async function AutocatalogPage() {
  const [stats, brands, models, live] = await Promise.all([
    readEncyclopediaStats(),
    readCatalogBrandDirectory(),
    readEncyclopediaKnowledgeModels(),
    readCatalogBrandCounts().catch(() => ({ counts: {} as Record<string, number> })),
  ]);
  const modelIdsByBrand = new Map<string, Set<string>>();
  for (const model of models) {
    if (model.active === false) continue;
    const make = canonicalCatalogBrand(clean(model.make));
    if (!make) continue;
    const ids = modelIdsByBrand.get(make) || new Set<string>();
    ids.add(clean(model.id) || clean(model.model));
    modelIdsByBrand.set(make, ids);
  }
  const liveCounts = new Map<string, number>();
  for (const [rawMake, rawCount] of Object.entries(live.counts || {})) {
    const make = canonicalCatalogBrand(rawMake);
    liveCounts.set(make, (liveCounts.get(make) || 0) + Number(rawCount || 0));
  }
  const directory: AutocatalogBrandItem[] = brands.map((brand) => ({
    name: brand.name,
    slug: brand.slug,
    aliases: [...new Set((brand.aliases || []).map(clean).filter(Boolean))],
    modelCount: modelIdsByBrand.get(brand.name)?.size || 0,
    offerCount: liveCounts.get(brand.name) || 0,
  })).sort((left, right) => left.name.localeCompare(right.name, "en"));

  return <main className="ac-autocatalog-page ac-page-copy min-h-screen overflow-x-hidden bg-[#07080d] text-white">
    <PublicHeader backHref="/cars" backLabel="В каталог" />
    <section className="mx-auto w-full max-w-[1500px] px-4 py-8 md:px-8 md:py-12">
      <nav className="text-xs font-black uppercase tracking-[0.15em] text-[var(--ac-muted)]" aria-label="Хлебные крошки">
        <Link href="/cars" className="hover:text-red-500">Каталог предложений</Link><span className="mx-2">/</span><span>Автокаталог</span>
      </nav>

      <header className="mt-5 grid gap-6 overflow-hidden rounded-[2rem] bg-[var(--ac-surface)] p-6 md:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)] md:items-end md:p-9">
        <div className="min-w-0">
          <div className="text-xs font-black uppercase tracking-[0.2em] text-red-500">Марка → модель → характеристики</div>
          <h1 className="mt-3 max-w-5xl text-4xl font-black leading-[.95] tracking-[-0.05em] md:text-7xl">Автокаталог</h1>
          <p className="mt-5 max-w-4xl text-sm font-medium leading-7 text-[var(--ac-muted)] md:text-base">Нормальная база автомобилей без свалки названий: одна каноническая марка, её проверенные написания на разных языках, модели, поколения и характеристики. Актуальные объявления остаются отдельно и всегда связаны с нужной моделью.</p>
          <div className="mt-5 flex flex-wrap gap-2 text-xs font-black">
            <span className="rounded-full bg-emerald-500/12 px-3 py-2 text-emerald-500">Источник каждого факта сохраняется</span>
            <span className="rounded-full bg-[var(--ac-surface-2)] px-3 py-2 text-[var(--ac-muted)]">Неизвестные названия идут на проверку</span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 md:grid-cols-1 xl:grid-cols-3">
          <div className="rounded-2xl bg-[var(--ac-surface-2)] p-4"><div className="text-2xl font-black md:text-3xl">{directory.length.toLocaleString("ru-RU")}</div><div className="mt-1 text-[10px] font-black uppercase tracking-wide text-[var(--ac-muted)]">марок</div></div>
          <div className="rounded-2xl bg-[var(--ac-surface-2)] p-4"><div className="text-2xl font-black md:text-3xl">{stats.models.toLocaleString("ru-RU")}</div><div className="mt-1 text-[10px] font-black uppercase tracking-wide text-[var(--ac-muted)]">моделей</div></div>
          <div className="rounded-2xl bg-[var(--ac-surface-2)] p-4"><div className="text-2xl font-black md:text-3xl">{stats.specifications.toLocaleString("ru-RU")}</div><div className="mt-1 text-[10px] font-black uppercase tracking-wide text-[var(--ac-muted)]">версий</div></div>
        </div>
      </header>

      <AutocatalogBrandDirectory brands={directory} />

      <section className="mt-10 grid gap-4 rounded-[1.8rem] bg-[var(--ac-surface)] p-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:p-8">
        <div><h2 className="text-2xl font-black md:text-4xl">Нужна конкретная машина?</h2><p className="mt-3 max-w-4xl text-sm font-medium leading-7 text-[var(--ac-muted)]">Откройте марку и модель, сравните известные характеристики, затем перейдите к живым предложениям или запросите расчёт под ключ.</p></div>
        <Link href="/cars" className="avto-button inline-flex min-h-12 items-center justify-center rounded-2xl px-5 text-center font-black md:justify-self-end">Перейти к автомобилям</Link>
      </section>
    </section>
  </main>;
}
