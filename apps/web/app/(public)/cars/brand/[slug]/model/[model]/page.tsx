import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandLogoVisual } from "@/components/catalog/BrandLogoRail";
import { CatalogCard } from "@/components/catalog/CatalogCard";
import { CatalogMarketFlag } from "@/components/catalog/CatalogMarketFlag";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { autocatalogCoverUrl, findAutocatalogPublishedCover } from "@/lib/catalog/autocatalog-publication";
import { catalogBrandMatches, resolveCatalogBrandBySlug } from "@/lib/catalog/catalog-brand-directory";
import { findBrandModelBySlug, readBrandModelDirectory } from "@/lib/catalog/model-directory";
import { isRenderablePublicCatalogOffer } from "@/lib/catalog/offer-quality";
import { CATALOG_MARKET_LABELS } from "@/lib/catalog/runtime-config";
import { readCatalogFacets, searchOffers } from "@/lib/catalog/storage";
import type { CatalogMarket } from "@/lib/catalog/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MARKET_ORDER: CatalogMarket[] = ["japan", "china", "korea", "uae", "europe", "georgia"];
type PageProps = { params: Promise<{ slug: string; model: string }> };

function yearRange(from?: number, to?: number) {
  if (from && to) return `${from}–${to}`;
  if (from) return `с ${from}`;
  if (to) return `до ${to}`;
  return "период уточняется";
}


export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, model: modelSlug } = await params;
  const brand = await resolveCatalogBrandBySlug(slug);
  if (!brand) return {};
  const model = await findBrandModelBySlug(brand.name, modelSlug);
  if (!model) return {};
  const title = `${brand.name} ${model.model} — предложения и расчёт`;
  const description = `Автокаталог ${brand.name} ${model.model}: доступные автомобили и расчёт стоимости с доставкой, таможней и утилизационным сбором.`;
  return {
    title,
    description,
    alternates: { canonical: `/cars/brand/${brand.slug}/model/${model.slug}` },
    openGraph: { title, description, url: `/cars/brand/${brand.slug}/model/${model.slug}`, type: "website" },
  };
}

export default async function ModelLandingPage({ params }: PageProps) {
  const { slug, model: modelSlug } = await params;
  const brand = await resolveCatalogBrandBySlug(slug);
  if (!brand) notFound();
  const [model, directory, facets] = await Promise.all([
    findBrandModelBySlug(brand.name, modelSlug),
    readBrandModelDirectory(brand.name),
    readCatalogFacets(),
  ]);
  if (!model) notFound();
  const publishedCover = await findAutocatalogPublishedCover(model.id);

  const rawMakes = [...new Set([
    brand.name,
    ...(facets.makes || []).filter((make) => catalogBrandMatches(brand, make)),
  ])];
  const results = await Promise.all(rawMakes.map((make) => searchOffers({ make, model: model.model, pageSize: 48, sort: "updatedAt" })));
  const uniqueOffers = new Map<string, any>();
  for (const result of results) {
    for (const offer of (result.items || []) as any[]) {
      if (isRenderablePublicCatalogOffer(offer)) uniqueOffers.set(String(offer.id), offer);
    }
  }
  const offers = [...uniqueOffers.values()];
  const heroImageUrl = String((publishedCover ? autocatalogCoverUrl(publishedCover) : "")
    || offers.find((offer: any) => offer.images?.[0]?.url || offer.cardImageUrl)?.images?.[0]?.url
    || offers.find((offer: any) => offer.cardImageUrl)?.cardImageUrl
    || "");
  const grouped = MARKET_ORDER.map((market) => ({ market, offers: offers.filter((offer: any) => offer.market === market) })).filter((group) => group.offers.length);
  const brandFallback = offers.length ? [] : (await searchOffers({ make: rawMakes.join(","), pageSize: 16, sort: "updatedAt" })).items.filter((offer: any) => isRenderablePublicCatalogOffer(offer)).slice(0, 12);
  const otherModels = directory.filter((item) => item.id !== model.id && item.count > 0).slice(0, 18);
  const canonicalUrl = `https://avtocena.com/cars/brand/${brand.slug}/model/${model.slug}`;
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: `${brand.name} ${model.model}`,
    description: `Предложения и расчёт стоимости ${brand.name} ${model.model} с доставкой, таможней и утилизационным сбором.`,
    url: canonicalUrl,
    brand: { "@type": "Brand", name: brand.name },
    ...(heroImageUrl ? { image: [heroImageUrl] } : {}),
  };

  return <main className="ac-model-catalog-page ac-page-copy min-h-screen overflow-x-hidden bg-[#07080d] text-white">
    <PublicHeader backHref={`/cars/brand/${brand.slug}`} backLabel={brand.name} />
    <section className="mx-auto w-full max-w-[1500px] px-4 py-8 md:px-8 md:py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <nav className="text-xs font-black uppercase tracking-[0.15em] text-[var(--ac-muted)]" aria-label="Хлебные крошки">
        <Link href="/cars/autocatalog" className="hover:text-red-500">Автокаталог</Link><span className="mx-2">/</span><Link href={`/cars/brand/${brand.slug}`} className="hover:text-red-500">{brand.name}</Link><span className="mx-2">/</span><span>{model.model}</span>
      </nav>

      <header className={`mt-5 grid gap-6 rounded-[2rem] bg-[var(--ac-surface)] p-5 md:items-center md:p-8 ${heroImageUrl ? "md:grid-cols-[minmax(300px,.8fr)_minmax(0,1.2fr)]" : "md:grid-cols-[170px_minmax(0,1fr)]"}`}>
        <div className={`flex items-center justify-center overflow-hidden rounded-[1.5rem] bg-[var(--ac-surface-2)] ${heroImageUrl ? "aspect-[16/10] md:aspect-[4/3]" : "h-32 md:h-40"}`}>
          {heroImageUrl ? <img src={heroImageUrl} alt={`${brand.name} ${model.model}`} width={960} height={720} loading="eager" className="h-full w-full object-cover" /> : <BrandLogoVisual brand={brand.name} className="!h-20 !w-32 md:!h-24 md:!w-36" />}
        </div>
        <div className="min-w-0">
          <div className="text-xs font-black uppercase tracking-[0.18em] text-red-500">Модель автомобиля</div>
          <h1 className="mt-2 break-words text-4xl font-black leading-[.98] tracking-[-0.045em] md:text-6xl">{brand.name} {model.model}</h1>
          <p className="mt-4 max-w-4xl text-sm font-medium leading-7 text-[var(--ac-muted)] md:text-base">Доступные автомобили {brand.name} {model.model} со всех рынков и расчёт стоимости под ключ.</p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs font-black">
            <span className="rounded-full bg-[var(--ac-surface-2)] px-3 py-2">{model.count ? `${model.count} предложений` : "Под заказ"}</span>
            <span className="rounded-full bg-[var(--ac-surface-2)] px-3 py-2">Выпуск: {yearRange(model.yearFrom, model.yearTo)}</span>
          </div>
          <button type="button" data-model-lead className="avto-button mt-5 inline-flex min-h-12 items-center rounded-2xl px-5 font-black">Рассчитать {brand.name} {model.model}</button>
        </div>
      </header>

      {grouped.length ? <div className="mt-10 space-y-12">
        {grouped.map((group) => <section key={group.market}>
          <div className="flex items-end justify-between gap-3">
            <h2 className="flex min-w-0 items-center gap-2 text-2xl font-black md:text-4xl"><CatalogMarketFlag market={group.market} className="h-5 w-7 md:h-6 md:w-9" /><span className="min-w-0 break-words">{CATALOG_MARKET_LABELS[group.market]}</span><span className="text-base text-[var(--ac-muted)]">· {group.offers.length}</span></h2>
            <Link href={`/cars?market=${group.market}&make=${encodeURIComponent(brand.name)}&model=${encodeURIComponent(model.model)}`} className="ac-market-all-link shrink-0 text-sm font-black">Все →</Link>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 xl:grid-cols-4">{group.offers.slice(0, 12).map((offer: any) => <CatalogCard key={offer.id} offer={offer} compact dense />)}</div>
        </section>)}
      </div> : <section className="mt-9 rounded-[1.8rem] bg-[var(--ac-surface)] p-6 md:p-8">
        <h2 className="text-2xl font-black md:text-4xl">Подберём {brand.name} {model.model}</h2>
        <p className="mt-3 max-w-4xl font-medium leading-7 text-[var(--ac-muted)]">Сейчас подходящих предложений нет. Оставьте запрос — менеджер проверит доступные варианты на семи рынках и подготовит расчёт под ключ.</p>
        <button type="button" data-model-lead className="avto-button mt-5 inline-flex min-h-12 items-center rounded-2xl px-5 font-black">Оставить запрос на {brand.name} {model.model}</button>
      </section>}

      {!offers.length && brandFallback.length ? <section className="mt-12">
        <div className="flex items-end justify-between gap-3"><h2 className="text-2xl font-black md:text-4xl">Другие предложения {brand.name}</h2><Link href={`/cars/brand/${brand.slug}`} className="text-sm font-black">Все модели →</Link></div>
        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 xl:grid-cols-4">{brandFallback.map((offer: any) => <CatalogCard key={offer.id} offer={offer} compact dense />)}</div>
      </section> : null}

      {otherModels.length ? <section className="mt-12 rounded-[1.8rem] bg-[var(--ac-surface)] p-5 md:p-7">
        <h2 className="text-2xl font-black md:text-3xl">Другие модели {brand.name}</h2>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">{otherModels.map((item) => <Link key={item.id} href={`/cars/brand/${brand.slug}/model/${item.slug}`} className="flex items-center justify-between gap-2 rounded-2xl bg-[var(--ac-surface-2)] px-3 py-3 text-sm font-black hover:text-red-500"><span className="truncate">{item.model}</span><span className="shrink-0 text-[10px] text-[var(--ac-muted)]">{item.count || "—"}</span></Link>)}</div>
      </section> : null}
    </section>
  </main>;
}
