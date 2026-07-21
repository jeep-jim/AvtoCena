import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandLogoVisual } from "@/components/catalog/BrandLogoRail";
import { CatalogCard } from "@/components/catalog/CatalogCard";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { canonicalCatalogBrand, catalogBrandBySlug } from "@/lib/catalog/brands";
import { isCrediblePublicOffer } from "@/lib/catalog/offer-quality";
import { readCatalogFacets, searchOffers } from "@/lib/catalog/storage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MARKET_META: Record<string, { label: string; flag: string }> = {
  japan: { label: "Япония", flag: "🇯🇵" },
  china: { label: "Китай", flag: "🇨🇳" },
  korea: { label: "Корея", flag: "🇰🇷" },
  uae: { label: "ОАЭ", flag: "🇦🇪" },
  europe: { label: "Европа", flag: "🇪🇺" },
};
const MARKET_ORDER = ["japan", "china", "korea", "uae", "europe"];

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const brand = catalogBrandBySlug(slug);
  if (!brand) return {};
  const title = `${brand.name} под заказ — купить и привезти автомобиль под ключ`;
  const description = `Автомобили ${brand.name} под заказ из Японии, Китая, Кореи, ОАЭ и Европы. Актуальные предложения, расчёт стоимости под ключ и доставка в Россию.`;
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

  const facets = await readCatalogFacets();
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
    for (const offer of entry.result.items || []) {
      if (isCrediblePublicOffer(offer)) uniqueOffers.set(String(offer.id), offer);
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
  const availableMarkets = grouped.map((group) => MARKET_META[group.market]);

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
            Купить {brand.name} под заказ, пригнать {brand.name} из-за рубежа и заранее рассчитать итоговую стоимость с доставкой, таможней, оформлением и утильсбором. Менеджер TopAvto проверит выбранный автомобиль и подтвердит финальный расчёт.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs font-black">
            {[`Купить ${brand.name}`, `Пригнать ${brand.name}`, `${brand.name} под ключ`, `${brand.name} с доставкой`].map((text) => <span key={text} className="rounded-full bg-[var(--ac-surface-2)] px-3 py-2 text-[var(--ac-text)]">{text}</span>)}
          </div>
        </div>
      </header>

      <section className="mt-7 rounded-[1.6rem] bg-[var(--ac-surface)] p-5 md:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="mr-auto text-xl font-black md:text-2xl">Где доступен {brand.name}</h2>
          {availableMarkets.length ? availableMarkets.map((market) => <span key={market.label} className="rounded-full bg-[var(--ac-surface-2)] px-3 py-2 text-sm font-black">{market.flag} {market.label}</span>) : <span className="text-sm font-bold text-[var(--ac-muted)]">Предложения обновляются</span>}
        </div>
      </section>

      {grouped.length ? <div className="mt-9 space-y-12">
        {grouped.map((group) => {
          const meta = MARKET_META[group.market];
          return <section key={group.market}>
            <div className="flex items-end justify-between gap-3">
              <h2 className="flex items-center gap-2 text-3xl font-black md:text-4xl"><span aria-hidden="true">{meta.flag}</span><span>{brand.name} из {meta.label === "ОАЭ" ? "ОАЭ" : meta.label}</span><span className="text-base text-[var(--ac-muted)]">· {group.offers.length}</span></h2>
              <Link href={`/cars?market=${group.market}&make=${encodeURIComponent(catalogMake)}`} className="ac-market-all-link shrink-0 text-sm font-black">Все →</Link>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 xl:grid-cols-4">
              {group.offers.slice(0, 12).map((offer: any) => <CatalogCard key={offer.id} offer={offer} compact dense />)}
            </div>
          </section>;
        })}
      </div> : <section className="mt-9 rounded-[1.8rem] bg-[var(--ac-surface)] p-6 md:p-8">
        <h2 className="text-2xl font-black md:text-4xl">Предложения {brand.name} уже ищем</h2>
        <p className="mt-3 max-w-3xl font-medium leading-7 text-[var(--ac-muted)]">Сейчас в открытом каталоге нет подходящих автомобилей этой марки. Страница остаётся постоянной, а новые предложения появятся здесь автоматически после следующего обновления источников.</p>
        <Link href="/#form" className="avto-button mt-5 inline-flex min-h-12 items-center rounded-2xl px-5 font-black">Запросить подбор {brand.name}</Link>
      </section>}

      {!offers.length && similar.length ? <section className="mt-12">
        <div className="flex items-end justify-between gap-3"><h2 className="text-3xl font-black md:text-4xl">Похожие варианты</h2><Link href="/cars" className="ac-market-all-link text-sm font-black">Весь каталог →</Link></div>
        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 xl:grid-cols-4">{similar.map((offer: any) => <CatalogCard key={offer.id} offer={offer} compact dense />)}</div>
      </section> : null}

      <section className="mt-12 rounded-[1.8rem] bg-[var(--ac-surface)] p-6 md:p-8">
        <h2 className="text-2xl font-black md:text-3xl">Как заказать {brand.name}</h2>
        <p className="mt-3 max-w-5xl text-sm font-medium leading-7 text-[var(--ac-muted)]">Выберите автомобиль в каталоге или оставьте параметры подбора. Мы проверим историю и состояние машины, подготовим расчёт под ключ, организуем покупку, доставку, таможенное оформление, получение ЭПТС и передачу автомобиля в вашем городе.</p>
      </section>
    </section>
  </main>;
}
