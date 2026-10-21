import {Suspense} from 'react';
import {BrandPreviewProvider,BrandPreviewUpdate} from '@/components/catalog/BrandPreviewContext';
import {AjesRail,readAjesRailData} from '@/components/catalog/AjesRail';
import {usesAjesMarket} from '@/lib/catalog/ajes-market-selection';
import { PageLeadBanner } from "@/components/leads/PublicLeadCaptureV2";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandLogoVisual } from "@/components/catalog/BrandLogoRail";
import { BrandModelDirectory } from "@/components/catalog/BrandModelDirectory";
import { CatalogCard } from "@/components/catalog/CatalogCard";
import { CatalogMarketFlag } from "@/components/catalog/CatalogMarketFlag";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { autocatalogCoverUrl, readAutocatalogCoverIndex } from "@/lib/catalog/autocatalog-publication";
import { resolveCatalogBrandBySlug } from "@/lib/catalog/catalog-brand-directory";
import { readBrandModelDirectory } from "@/lib/catalog/model-directory";
import { isRenderablePublicCatalogOffer } from "@/lib/catalog/offer-quality";
import { CATALOG_MARKET_LABELS, PUBLIC_CATALOG_MARKETS } from "@/lib/catalog/runtime-config";
import { readCatalogBrandModelCounts, searchOffers } from "@/lib/catalog/storage";
import type { CatalogMarket } from "@/lib/catalog/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MARKET_ORDER: CatalogMarket[] = PUBLIC_CATALOG_MARKETS;

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const brand = await resolveCatalogBrandBySlug(slug);
  if (!brand) return {};
  const title = `${brand.name} — модели, характеристики и цены | Автокаталог`;
  const description = `Автокаталог ${brand.name}: модели, характеристики, мощность и актуальные предложения из Японии, Китая, Кореи, ОАЭ, Европы и Грузии.`;
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

  const [counts, models, publishedCovers] = await Promise.all([
    readCatalogBrandModelCounts(brand.name),
    readBrandModelDirectory(brand.name),
    readAutocatalogCoverIndex(),
  ]);
  const saleModels = models.filter((model) => model.count > 0);
  const modelsWithPreviews = saleModels.map((model) => {
    const published = publishedCovers.get(model.id);
    return { ...model, previewUrl: (published ? autocatalogCoverUrl(published) : undefined) };
  });
  const catalogMakes = brand.name;
  const totalOffers = counts.models.reduce((sum,model)=>sum+model.count,0);
  const availableMarkets = MARKET_ORDER.filter(market=>counts.models.some(model=>model.marketCounts[market]>0));

  return <main className="ac-brand-catalog-page ac-page-copy min-h-screen overflow-x-hidden bg-[#07080d] text-white">
    <PublicHeader backHref="/cars" backLabel="В каталог" />
    <section className="mx-auto w-full max-w-[1500px] px-4 py-8 md:px-8 md:py-12">
      <nav className="text-xs font-black normal-case tracking-normal text-[var(--ac-muted)]" aria-label="Хлебные крошки">
        <Link href="/cars/autocatalog" className="hover:text-red-500">Автокаталог</Link><span className="mx-2">/</span><span>{brand.name}</span>
      </nav>

      <header className="mt-5 grid gap-6 rounded-[2rem] bg-[var(--ac-surface)] p-5 shadow-[0_22px_70px_rgba(0,0,0,.16)] md:grid-cols-[170px_minmax(0,1fr)] md:items-center md:p-8">
        <div className="flex h-32 items-center justify-center rounded-[1.5rem] bg-[var(--ac-surface-2)] text-[var(--ac-muted)] md:h-40">
          <BrandLogoVisual brand={brand.name} className="!h-20 !w-32 md:!h-24 md:!w-36" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-black normal-case tracking-normal text-red-500">Марка автомобиля</div>
          <h1 className="mt-2 break-words text-4xl font-black leading-[.98] tracking-[-0.045em] md:text-6xl">{brand.name}</h1>
          <p className="mt-4 max-w-4xl text-sm font-medium leading-7 text-[var(--ac-muted)] md:text-base">
            Выберите модель {brand.name}, чтобы посмотреть автомобили, характеристики и стоимость под ключ.
          </p>
          <div className="mt-5 flex flex-wrap gap-2 text-xs font-black">
            <span className="rounded-full bg-[var(--ac-surface-2)] px-3 py-2">{saleModels.length} моделей в продаже</span>
            {totalOffers ? <span className="rounded-full bg-[var(--ac-surface-2)] px-3 py-2">{totalOffers.toLocaleString("ru-RU")} автомобилей</span> : null}
            <span className="rounded-full bg-[var(--ac-surface-2)] px-3 py-2">{availableMarkets.length} {availableMarkets.length === 1 ? "рынок" : "рынков"}</span>
          </div>
          {availableMarkets.length ? <div className="mt-3 flex flex-wrap gap-2">{availableMarkets.map((market) => <span key={market} className="inline-flex items-center gap-2 rounded-full bg-[var(--ac-surface-2)] px-3 py-2 text-xs font-black"><CatalogMarketFlag market={market} className="h-4 w-6" />{CATALOG_MARKET_LABELS[market]}</span>)}</div> : null}
        </div>
      </header>

      <BrandPreviewProvider key={brand.slug}><BrandModelDirectory brand={brand.name} brandSlug={brand.slug} models={modelsWithPreviews} />

      <div className="mt-9 space-y-12">{MARKET_ORDER.map(market=><Suspense key={market} fallback={<p role="status" className="text-sm text-[var(--ac-muted)]">Загружаем предложения · {CATALOG_MARKET_LABELS[market]}</p>}><BrandMarketOffers market={market} make={catalogMakes}/></Suspense>)}</div></BrandPreviewProvider>

      <section className="mt-12 rounded-[1.8rem] bg-[var(--ac-surface)] p-6 md:p-8">
        <h2 className="text-2xl font-black md:text-3xl">Как заказать {brand.name}</h2>
        <p className="mt-3 max-w-5xl text-sm font-medium leading-7 text-[var(--ac-muted)]">Выберите модель или автомобиль в каталоге. Мы проверим историю и состояние машины, подготовим расчёт под ключ, организуем покупку, доставку, таможенное оформление, получение ЭПТС и передачу автомобиля в вашем городе.</p>
      </section>
      <PageLeadBanner kind="brand" car={brand.name} />
    </section>
  </main>;
}

async function BrandMarketOffers({market,make}:{market:CatalogMarket;make:string}){
  if(await usesAjesMarket(market)){
    const sourceMarket=market as 'japan'|'china'|'korea';
    const result=await readAjesRailData(sourceMarket,{make});
    return <><BrandPreviewUpdate rows={result.items.flatMap((offer:any)=>{const url=offer.images?.[0]?.url;return url?[{model:offer.model,url}]:[];})}/><AjesRail market={sourceMarket} params={{make}} prepared={Promise.resolve(result)}/></>;
  }
  const result=await searchOffers({market,make,pageSize:12,sort:'updatedAt'});
  const offers=result.items.filter(offer=>isRenderablePublicCatalogOffer(offer));
  if(!offers.length)return null;
  return <section>
    <BrandPreviewUpdate rows={offers.flatMap(offer=>{const url=offer.images?.[0]?.url;return url?[{model:offer.model,url}]:[];})}/>
    <div className="flex items-end justify-between gap-3">
      <h2 className="flex items-center gap-2 text-3xl font-black"><CatalogMarketFlag market={market} className="h-5 w-7"/>{CATALOG_MARKET_LABELS[market]}<span className="text-base text-[var(--ac-muted)]">· {result.total.toLocaleString('ru-RU')}</span></h2>
      <Link href={`/cars?market=${market}&make=${encodeURIComponent(make)}`} className="ac-market-all-link text-sm font-black">Все →</Link>
    </div>
    <div className="mt-5 grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-4">{offers.map(offer=><CatalogCard key={offer.id} offer={offer} compact dense/>)}</div>
  </section>;
}
