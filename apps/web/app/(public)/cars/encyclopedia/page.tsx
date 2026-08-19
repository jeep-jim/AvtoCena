import type { Metadata } from "next";
import Link from "next/link";
import { BrandLogoRail } from "@/components/catalog/BrandLogoRail";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { readCatalogBrandDirectory } from "@/lib/catalog/catalog-brand-directory";
import { readEncyclopediaStats } from "@/lib/catalog/encyclopedia";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Энциклопедия автомобилей — марки, модели и характеристики | АвтоЦена",
  description: "Энциклопедия автомобилей АвтоЦена: марки, модели, модификации, мощность и технические характеристики. Связь с актуальными предложениями и расчётом автомобиля под ключ.",
  alternates: { canonical: "/cars/encyclopedia" },
  openGraph: {
    title: "Энциклопедия автомобилей АвтоЦена",
    description: "Марки, модели, модификации и проверенные характеристики автомобилей в единой базе АвтоЦены.",
    url: "/cars/encyclopedia",
    type: "website",
  },
};

export default async function EncyclopediaPage() {
  const stats = await readEncyclopediaStats();
  const brands = await readCatalogBrandDirectory();

  return <main className="ac-page-copy min-h-screen overflow-x-hidden bg-[#07080d] text-white">
    <PublicHeader backHref="/cars" backLabel="В каталог" />
    <section className="mx-auto w-full max-w-[1500px] px-4 py-8 md:px-8 md:py-12">
      <nav className="text-xs font-black uppercase tracking-[0.15em] text-[var(--ac-muted)]" aria-label="Хлебные крошки">
        <Link href="/cars" className="hover:text-red-500">Каталог</Link><span className="mx-2">/</span><span>Энциклопедия</span>
      </nav>

      <header className="mt-5 overflow-hidden rounded-[2rem] bg-[var(--ac-surface)] p-6 shadow-[0_24px_90px_rgba(0,0,0,.22)] md:p-10">
        <div className="text-xs font-black uppercase tracking-[0.2em] text-red-500">Марки и модели автомобилей</div>
        <h1 className="mt-3 max-w-5xl text-4xl font-black leading-[.95] tracking-[-0.05em] md:text-7xl">Энциклопедия автомобилей</h1>
        <p className="mt-5 max-w-4xl text-sm font-medium leading-7 text-[var(--ac-muted)] md:text-base">Марки, модели, поколения и проверенные модификации в одной базе. Характеристики связаны с каталогом АвтоЦены: от страницы модели можно сразу перейти к актуальным автомобилям и расчёту под ключ.</p>
        <div className="mt-7 grid grid-cols-2 gap-3 md:max-w-4xl md:grid-cols-3">
          <div className="rounded-2xl bg-[var(--ac-surface-2)] p-4"><div className="text-2xl font-black md:text-3xl">{brands.length}</div><div className="mt-1 text-xs font-black uppercase tracking-wide text-[var(--ac-muted)]">марок сайта</div></div>
          <div className="rounded-2xl bg-[var(--ac-surface-2)] p-4"><div className="text-2xl font-black md:text-3xl">{stats.models.toLocaleString("ru-RU")}</div><div className="mt-1 text-xs font-black uppercase tracking-wide text-[var(--ac-muted)]">моделей</div></div>
          <div className="col-span-2 rounded-2xl bg-[var(--ac-surface-2)] p-4 md:col-span-1"><div className="text-2xl font-black md:text-3xl">{stats.specifications.toLocaleString("ru-RU")}</div><div className="mt-1 text-xs font-black uppercase tracking-wide text-[var(--ac-muted)]">вариантов характеристик</div></div>
        </div>
      </header>

      <section className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><div className="text-xs font-black uppercase tracking-[0.16em] text-red-500">Марки</div><h2 className="mt-1 text-3xl font-black md:text-5xl">Найдите свою марку</h2></div>
          <Link href="/cars" className="ac-market-all-link text-sm font-black">Актуальные предложения →</Link>
        </div>
        <p className="mt-3 max-w-4xl text-sm font-medium leading-6 text-[var(--ac-muted)]">Одна марка объединяет автомобили со всех рынков. Введите название или пролистайте логотипы, чтобы открыть модели, характеристики и доступные предложения.</p>
        <BrandLogoRail brands={brands.map((brand) => brand.name)} directoryMode showSearch />
      </section>

      <section className="mt-12 grid gap-4 rounded-[1.8rem] bg-[var(--ac-surface)] p-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:p-8">
        <div><h2 className="text-2xl font-black md:text-4xl">Нашли нужную модель?</h2><p className="mt-3 max-w-4xl text-sm font-medium leading-7 text-[var(--ac-muted)]">На странице модели показаны известные характеристики и доступные автомобили. Если подходящей карточки сейчас нет, АвтоЦена выполнит поиск по рынкам и подготовит расчёт.</p></div>
        <Link href="/#form" className="avto-button inline-flex min-h-12 items-center justify-center rounded-2xl px-5 text-center font-black md:justify-self-end">Рассчитать автомобиль</Link>
      </section>
    </section>
  </main>;
}
