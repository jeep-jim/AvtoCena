import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandLogoVisual } from "@/components/catalog/BrandLogoRail";
import { BrandModelDirectory } from "@/components/catalog/BrandModelDirectory";
import { CatalogCard } from "@/components/catalog/CatalogCard";
import { CatalogMarketFlag } from "@/components/catalog/CatalogMarketFlag";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { catalogBrandMatches, resolveCatalogBrandBySlug } from "@/lib/catalog/catalog-brand-directory";
import { readBrandModelDirectory } from "@/lib/catalog/model-directory";
import { isCrediblePublicOffer } from "@/lib/catalog/offer-quality";
import { CATALOG_MARKET_LABELS } from "@/lib/catalog/runtime-config";
import { readCatalogFacets, searchOffers } from "@/lib/catalog/storage";
import type { CatalogMarket } from "@/lib/catalog/types";
import { vehicleKnowledgeCompact } from "@/lib/catalog/vehicle-knowledge";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MARKET_ORDER: CatalogMarket[] = ["japan", "china", "korea", "uae", "europe", "georgia", "kyrgyzstan"];

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const brand = await resolveCatalogBrandBySlug(slug);
  if (!brand) return {};
  const title = `${brand.name} — модели, характеристики и цены | Автокаталог`;
  const description = `Автокаталог ${brand.name}: модели, характеристики, мощность и актуальные предложения из Японии, Китая, Кореи, ОАЭ, Европы, Грузии и Кыргызстана.`;
  return {
    title,
    description,
    alternates: { canonical: `/cars/brand/${brand.slug}` },
    openGraph: { title, description, url: `/cars/brand/${brand.slug}`, type: "website" },
  };
}

export default async function BrandLandingPage({ params }: PageProps) {
  const { slug } = await params;
  const brand = await resolveCatalogBrandBySlug(slug);
  if (!brand) notFound();

  const [facets, models] = await Promise.all([
    readCatalogFacets(),
    readBrandModelDirectory(brand.name),
  ]);
  const rawMakes = [...new Set([
    brand.name,
    ...(facets.makes || []).filter((make) => catalogBrandMatches(brand, make)),
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
  const modelByAlias = new Map<string, string | null>();
  for (const model of models) {
    for (const value of [model.model, ...(model.aliases || [])]) {
      const key = vehicleKnowledgeCompact(value);
      if (!key) continue;
      const current = modelByAlias.get(key);
      modelByAlias.set(key, current && current !== model.id ? null : model.id);
    }
  }
  const previewByModel = new Map<string, string>();
  for (const offer of offers) {
    const modelId = modelByAlias.get(vehicleKnowledgeCompact(offer.model));
    const previewUrl = String(offer.images?.[0]?.url || offer.cardImageUrl || "");
    if (modelId && previewUrl && !previewByModel.has(modelId)) previewByModel.set(modelId, previewUrl);
  }
  const modelsWithPreviews = models.map((model) => ({ ...model, previewUrl: previewByModel.get(model.id) }));
  const catalogMakes = rawMakes.join(",");
  const totalOffers = makeResults.reduce((sum, entry) => sum + Number(entry.result.total || 0), 0);
  const grouped = MARKET_ORDER.map((market) => ({
    market,
    offers: offers.filter((offer: any) => offer.market === market),
  })).filter((group) => group.offers.length);

  const fallbackResult = offers.length ? null : await searchOffers({ pageSize: 16, sort: "updatedAt" });
  const similar = (fallbackResult?.items || []).filter((offer: any) => isCrediblePublicOffer(offer)).slice(0, 12);
  const availableMarkets = grouped.map((group) => group.market);

  return <main className="ac-brand-catalog-page ac-page-copy min-h-screen overflow-x-hidden bg-[#07080d] text-white">
    <PublicHeader backHref="/cars" backLabel="В каталог" />
    <section className="mx-auto w-full max-w-[1500px] px-4 py-8 md:px-8 md:py-12">
      <nav className="text-xs font-black uppercase tracking-[0.15em] text-[var(--ac-muted)]" aria-label="Хлебные крошки">
        <Link href="/cars/autocatalog" className="hover:text-red-500">Автокаталог</Link><span className="mx-2">/</span><span>{brand.name}</span>
      </nav>

      <header className="mt-5 grid gap-6 rounded-[2rem] bg-[var(--ac-surface)] p-5 shadow-[0_22px_70px_rgba(0,0,0,.16)] md:grid-cols-[170px_minmax(0,1fr)] md:items-center md:p-8">
        <div className="flex h-32 items-center justify-center rounded-[1.5rem] bg-[var(--ac-surface-2)] text-[var(--ac-muted)] md:h-40">
          <BrandLogoVisual brand={brand.name} className="!h-20 !w-32 md:!h-24 md:!w-36" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-black uppercase tracking-[0.18em] text-red-500">Марка автомобиля</div>
          <h1 className="mt-2 break-words text-4xl font-black leading-[.98] tracking-[-0.045em] md:text-6xl">{brand.name}</h1>
          <p className="mt-4 max-w-4xl text-sm font-medium leading-7 text-[var(--ac-muted)] md:text-base">
            Модели {brand.name}, их характеристики и автомобили из Японии, Китая, Кореи, ОАЭ, Европы, Грузии и Кыргызстана. Все варианты марки собраны на одной странице независимо от рынка.
          </p>
          <div className="mt-5 flex flex-wrap gap-2 text-xs font-black">
            <span className="rounded-full bg-[var(--ac-surface-2)] px-3 py-2">{models.length} моделей</span>
            {totalOffers ? <span className="rounded-full bg-[var(--ac-surface-2)] px-3 py-2">{totalOffers.toLocaleString("ru-RU")} автомобилей</span> : null}
            <span className="rounded-full bg-[var(--ac-surface-2)] px-3 py-2">{availableMarkets.length || 7} {availableMarkets.length === 1 ? "рынок" : "рынков"}</span>
          </div>
          {availableMarkets.length ? <div className="mt-3 flex flex-wrap gap-2">{availableMarkets.map((market) => <span key={market} className="inline-flex items-center gap-2 rounded-full bg-[var(--ac-surface-2)] px-3 py-2 text-xs font-black"><CatalogMarketFlag market={market} className="h-4 w-6" />{CATALOG_MARKET_LABELS[market]}</span>)}</div> : null}
        </div>
      </header>

      <BrandModelDirectory brand={brand.name} brandSlug={brand.slug} models={modelsWithPreviews} />

      {grouped.length ? <div className="mt-9 space-y-12">
        {grouped.map((group) => {
          const label = CATALOG_MARKET_LABELS[group.market];
          return <section key={group.market}>
            <div className="flex items-end justify-between gap-3">
              <h2 className="flex items-center gap-2 text-3xl font-black md:text-4xl"><CatalogMarketFlag market={group.market} className="h-5 w-7 md:h-6 md:w-9" /><span>{label}</span><span className="text-base text-[var(--ac-muted)]">· {group.offers.length}</span></h2>
              <Link href={`/cars?market=${group.market}&make=${encodeURIComponent(catalogMakes)}`} className="ac-market-all-link shrink-0 text-sm font-black">Все →</Link>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 xl:grid-cols-4">
              {group.offers.slice(0, 12).map((offer: any) => <CatalogCard key={offer.id} offer={offer} compact dense />)}
            </div>
          </section>;
        })}
      </div> : <section className="mt-9 grid gap-5 rounded-[1.8rem] bg-[var(--ac-surface)] p-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:p-8">
        <div className="min-w-0">
          <h2 className="text-2xl font-black md:text-4xl">Подберём {brand.name} под ваш бюджет</h2>
          <p className="mt-3 max-w-3xl font-medium leading-7 text-[var(--ac-muted)]">Сейчас готовых предложений этой марки нет. Выберите модель выше или оставьте заявку — менеджер найдёт подходящие автомобили и подготовит расчёт под ключ.</p>
        </div>
        <Link href="/#form" className="avto-button inline-flex min-h-12 items-center justify-center rounded-2xl px-5 text-center font-black md:justify-self-end">Запросить подбор {brand.name}</Link>
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
