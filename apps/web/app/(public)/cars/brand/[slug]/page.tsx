import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandLogoVisual } from "@/components/catalog/BrandLogoRail";
import { CatalogCard } from "@/components/catalog/CatalogCard";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { canonicalCatalogBrand, catalogBrandBySlug } from "@/lib/catalog/brands";
import { readBrandModelDirectory } from "@/lib/catalog/model-directory";
import { isCrediblePublicOffer } from "@/lib/catalog/offer-quality";
import { CATALOG_MARKET_FLAGS, CATALOG_MARKET_LABELS } from "@/lib/catalog/runtime-config";
import { readCatalogFacets, searchOffers } from "@/lib/catalog/storage";
import type { CatalogMarket } from "@/lib/catalog/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MARKET_ORDER: CatalogMarket[] = ["japan", "china", "korea", "uae", "europe", "georgia", "kyrgyzstan"];

type PageProps = { params: Promise<{ slug: string }> };

function offerWord(count: number) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 19) return "автомобилей";
  if (mod10 === 1) return "автомобиль";
  if (mod10 >= 2 && mod10 <= 4) return "автомобиля";
  return "автомобилей";
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const brand = catalogBrandBySlug(slug);
  if (!brand) return {};
  const title = `${brand.name} под заказ — модели, цены и расчёт под ключ`;
  const description = `Все модели ${brand.name} под заказ из Японии, Китая, Кореи, ОАЭ, Европы, Грузии и Кыргызстана. Актуальные объявления, ориентировочная цена с таможней и доставка в Россию.`;
  return {
    title,
    description,
    alternates: { canonical: `/cars/brand/${brand.slug}` },
    openGraph: { title, description, url: `/cars/brand/${brand.slug}`, type: "website" },
  };
}

export default async function BrandLandingPage({ params }: PageProps) {
  const { slug } = await params;
  const brand = catalogBrandBySlug(slug);
  if (!brand) notFound();

  const [facets, models] = await Promise.all([
    readCatalogFacets(),
    readBrandModelDirectory(brand.name),
  ]);
  const rawMakes = [...new Set([
    brand.name,
    ...(facets.makes || []).filter((make) => canonicalCatalogBrand(String(make)) === brand.name),
  ])];
  const makeResults = await Promise.all(rawMakes.map(async (make) => ({
    make,
    result: await searchOffers({ make, pageSize: 48, sort: "updatedAt" }),
  })));
  const uniqueOffers = new Map<string, any>();
  for (const entry of makeResults) {
    for (const offer of (entry.result.items || []) as any[]) {
      if (isCrediblePublicOffer(offer as any)) uniqueOffers.set(String(offer.id), offer);
    }
  }
  const offers = [...uniqueOffers.values()];
  const catalogMake = makeResults.find((entry) => entry.result.total > 0)?.make || brand.name;
  const grouped = MARKET_ORDER.map((market) => ({
    market,
    offers: offers.filter((offer: any) => offer.market === market),
  })).filter((group) => group.offers.length);

  const fallbackResult = offers.length ? null : await searchOffers({ pageSize: 16, sort: "updatedAt" });
  const similar = (fallbackResult?.items || []).filter((offer: any) => isCrediblePublicOffer(offer)).slice(0, 12);
  const availableMarkets = grouped.map((group) => group.market);
  const liveModelCount = models.filter((model) => model.count > 0).length;
  const totalLiveOffers = models.reduce((sum, model) => sum + model.count, 0);

  return <main className="ac-brand-catalog-page ac-page-copy min-h-screen overflow-x-hidden bg-[#07080d] text-white">
    <PublicHeader backHref="/cars" backLabel="В каталог" />
    <section className="mx-auto w-full max-w-[1500px] px-4 py-8 md:px-8 md:py-12">
      <nav className="text-xs font-black uppercase tracking-[0.15em] text-[var(--ac-muted)]" aria-label="Хлебные крошки">
        <Link href="/cars" className="hover:text-red-500">Каталог</Link><span className="mx-2">/</span><span>{brand.name}</span>
      </nav>

      <header className="mt-5 grid gap-6 rounded-[2rem] bg-[var(--ac-surface)] p-5 shadow-[0_22px_70px_rgba(0,0,0,.16)] md:grid-cols-[170px_minmax(0,1fr)] md:items-center md:p-8">
        <div className="flex h-32 items-center justify-center rounded-[1.5rem] bg-[var(--ac-surface-2)] text-[var(--ac-muted)] md:h-40">
          <BrandLogoVisual brand={brand.name} className="!h-20 !w-32 md:!h-24 md:!w-36" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-black uppercase tracking-[0.18em] text-red-500">Автомобили под заказ</div>
          <h1 className="mt-2 break-words text-4xl font-black leading-[.98] tracking-[-0.045em] md:text-6xl">{brand.name} под ключ</h1>
          <p className="mt-4 max-w-4xl text-sm font-medium leading-7 text-[var(--ac-muted)] md:text-base">
            Выберите любую модель {brand.name} из нашей базы знаний. Даже если готового объявления сейчас нет, страница модели доступна постоянно: АвтоЦена покажет ориентир расчёта, похожие варианты и автоматически добавит новые автомобили после обновления семи рынков.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs font-black">
            <span className="rounded-full bg-[var(--ac-surface-2)] px-3 py-2 text-[var(--ac-text)]">{models.length} моделей</span>
            <span className="rounded-full bg-[var(--ac-surface-2)] px-3 py-2 text-[var(--ac-text)]">{liveModelCount} моделей в наличии</span>
            <span className="rounded-full bg-[var(--ac-surface-2)] px-3 py-2 text-[var(--ac-text)]">{totalLiveOffers} {offerWord(totalLiveOffers)}</span>
          </div>
        </div>
      </header>

      <section className="mt-7 rounded-[1.6rem] bg-[var(--ac-surface)] p-5 md:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="mr-auto text-xl font-black md:text-2xl">Где доступен {brand.name}</h2>
          {availableMarkets.length ? availableMarkets.map((market) => <span key={market} className="rounded-full bg-[var(--ac-surface-2)] px-3 py-2 text-sm font-black">{CATALOG_MARKET_FLAGS[market]} {CATALOG_MARKET_LABELS[market]}</span>) : <span className="text-sm font-bold text-[var(--ac-muted)]">Предложения обновляются на семи рынках</span>}
        </div>
      </section>

      <section className="mt-7 rounded-[1.8rem] bg-[var(--ac-surface)] p-5 md:p-7">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><div className="text-xs font-black uppercase tracking-[0.16em] text-red-500">База знаний АвтоЦены</div><h2 className="mt-1 text-2xl font-black md:text-4xl">Все модели {brand.name}</h2></div>
          <span className="text-sm font-bold text-[var(--ac-muted)]">{models.length} моделей</span>
        </div>
        {models.length ? <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {models.map((model) => <Link key={model.id} href={`/cars/brand/${brand.slug}/model/${model.slug}`} className="group flex min-h-14 items-center justify-between gap-2 rounded-2xl bg-[var(--ac-surface-2)] px-3 py-3 transition hover:-translate-y-0.5 hover:bg-red-500/10">
            <span className="min-w-0 truncate text-sm font-black group-hover:text-red-500">{model.model}</span>
            <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black ${model.count ? "bg-red-500 text-white" : "bg-[var(--ac-surface-3)] text-[var(--ac-muted)]"}`}>{model.count ? model.count : "Под заказ"}</span>
          </Link>)}
        </div> : <p className="mt-4 text-sm font-bold text-[var(--ac-muted)]">Справочник моделей обновляется.</p>}
      </section>

      {grouped.length ? <div className="mt-9 space-y-12">
        {grouped.map((group) => {
          const label = CATALOG_MARKET_LABELS[group.market];
          return <section key={group.market}>
            <div className="flex items-end justify-between gap-3">
              <h2 className="flex items-center gap-2 text-3xl font-black md:text-4xl"><span aria-hidden="true">{CATALOG_MARKET_FLAGS[group.market]}</span><span>{brand.name} из {label}</span><span className="text-base text-[var(--ac-muted)]">· {group.offers.length}</span></h2>
              <Link href={`/cars?market=${group.market}&make=${encodeURIComponent(catalogMake)}`} className="ac-market-all-link shrink-0 text-sm font-black">Все →</Link>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 xl:grid-cols-4">
              {group.offers.slice(0, 12).map((offer: any) => <CatalogCard key={offer.id} offer={offer} compact dense />)}
            </div>
          </section>;
        })}
      </div> : <section className="mt-9 rounded-[1.8rem] bg-[var(--ac-surface)] p-6 md:p-8">
        <h2 className="text-2xl font-black md:text-4xl">Предложения {brand.name} уже ищем</h2>
        <p className="mt-3 max-w-3xl font-medium leading-7 text-[var(--ac-muted)]">Сейчас в открытом каталоге нет подходящих автомобилей этой марки. Выберите нужную модель выше — её страница и форма расчёта доступны независимо от текущего наличия.</p>
        <Link href="/#form" className="avto-button mt-5 inline-flex min-h-12 items-center rounded-2xl px-5 font-black">Запросить подбор {brand.name}</Link>
      </section>}

      {!offers.length && similar.length ? <section className="mt-12">
        <div className="flex items-end justify-between gap-3"><h2 className="text-3xl font-black md:text-4xl">Похожие варианты</h2><Link href="/cars" className="ac-market-all-link text-sm font-black">Весь каталог →</Link></div>
        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 xl:grid-cols-4">{similar.map((offer: any) => <CatalogCard key={offer.id} offer={offer} compact dense />)}</div>
      </section> : null}

      <section className="mt-12 rounded-[1.8rem] bg-[var(--ac-surface)] p-6 md:p-8">
        <h2 className="text-2xl font-black md:text-3xl">Как заказать {brand.name}</h2>
        <p className="mt-3 max-w-5xl text-sm font-medium leading-7 text-[var(--ac-muted)]">Выберите модель или автомобиль в каталоге. Мы проверим историю и состояние машины, подготовим расчёт под ключ, организуем покупку, доставку, таможенное оформление, получение ЭПТС и передачу автомобиля в вашем городе.</p>
      </section>
    </section>
  </main>;
}
