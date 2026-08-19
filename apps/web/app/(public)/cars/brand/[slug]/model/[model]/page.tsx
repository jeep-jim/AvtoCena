import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandLogoVisual } from "@/components/catalog/BrandLogoRail";
import { CatalogCard } from "@/components/catalog/CatalogCard";
import { CatalogMarketFlag } from "@/components/catalog/CatalogMarketFlag";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { catalogBrandMatches, resolveCatalogBrandBySlug } from "@/lib/catalog/catalog-brand-directory";
import { findBrandModelBySlug, readBrandModelDirectory, type CatalogNumericRange } from "@/lib/catalog/model-directory";
import { isCrediblePublicOffer } from "@/lib/catalog/offer-quality";
import { readVehiclePowerKnowledge } from "@/lib/catalog/power-knowledge";
import { CATALOG_MARKET_LABELS } from "@/lib/catalog/runtime-config";
import { readCatalogFacets, searchOffers } from "@/lib/catalog/storage";
import type { CatalogMarket } from "@/lib/catalog/types";
import { readEncyclopediaKnowledgeVariants } from "@/lib/catalog/encyclopedia";
import { vehicleKnowledgeCompact } from "@/lib/catalog/vehicle-knowledge";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MARKET_ORDER: CatalogMarket[] = ["japan", "china", "korea", "uae", "europe", "georgia", "kyrgyzstan"];
type PageProps = { params: Promise<{ slug: string; model: string }> };

type PublicKnowledgeRow = {
  id: string;
  source: string;
  variantName?: string;
  generation?: string;
  generationStatus?: string;
  facelift?: string;
  faceliftStatus?: string;
  yearFrom?: number;
  yearTo?: number;
  engineCc?: number;
  fuel?: string;
  transmission?: string;
  drive?: string;
  powertrainKind?: string;
  powerHp?: number;
  powerKw?: number;
  icePowerKw?: number;
  motorPeakKw?: number;
  systemPowerKw?: number;
  power30MinKw?: number;
  utilizationPowerKw?: number;
  encyclopediaStatus?: string;
  evidenceOfficial?: boolean;
};

function yearRange(from?: number, to?: number) {
  if (from && to) return `${from}–${to}`;
  if (from) return `с ${from}`;
  if (to) return `до ${to}`;
  return "период уточняется";
}

function compactNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".0", "");
}

function rangeText(range?: CatalogNumericRange, unit = "") {
  if (!range) return "";
  const value = range.min === range.max ? compactNumber(range.min) : `${compactNumber(range.min)}–${compactNumber(range.max)}`;
  return `${value}${unit ? ` ${unit}` : ""}`;
}

function positive(value: unknown, max = 10_000) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= max ? number : undefined;
}

function totalThirtyMinute(row: { power30MinKw?: number; power30MinKwByMotor?: number[] }) {
  const direct = positive(row.power30MinKw, 4_000);
  if (direct) return direct;
  const motors = (row.power30MinKwByMotor || []).map((value) => positive(value, 2_000)).filter((value): value is number => Boolean(value));
  return motors.length ? Math.round(motors.reduce((sum, value) => sum + value, 0) * 100) / 100 : undefined;
}

function knowledgeSignature(row: PublicKnowledgeRow) {
  return [
    vehicleKnowledgeCompact(row.variantName), row.yearFrom || 0, row.yearTo || 0, row.engineCc || 0,
    vehicleKnowledgeCompact(row.fuel), vehicleKnowledgeCompact(row.generation), row.encyclopediaStatus || "",
    Math.round(Number(row.powerHp || 0) * 10) / 10, Math.round(Number(row.power30MinKw || 0) * 100) / 100,
  ].join("|");
}

function trustedKnowledgeRow(row: PublicKnowledgeRow) {
  if (row.source !== "encyclopedia_v2") return true;
  if (row.encyclopediaStatus === "verified") return true;
  return row.encyclopediaStatus === "seed" && row.evidenceOfficial === true;
}

function sourceLabel(row: PublicKnowledgeRow) {
  if (row.source.includes("manufacturer")) return "Производитель";
  if (row.source.includes("official_registry") || row.source === "power_registry") return "Официальный реестр";
  if (row.source.includes("drom")) return "Каталог модификаций";
  if (row.source.includes("consensus")) return "Подтверждено источниками";
  if (row.source.includes("manual")) return "Проверено АвтоЦена";
  if (row.source.includes("encyclopedia_v2")) {
    if (row.encyclopediaStatus === "verified") return "Проверено АвтоЦена";
    if (row.encyclopediaStatus === "seed" && row.evidenceOfficial) return "Официальный источник";
    return "Наблюдение источника";
  }
  return "База АвтоЦена";
}

function TrustedSpecCard({ row, brand, model }: { row: PublicKnowledgeRow; brand: string; model: string }) {
  return <article className="rounded-2xl bg-[var(--ac-surface-2)] p-4">
    <div className="flex items-start justify-between gap-3"><div className="font-black">{row.variantName || row.generation || `${brand} ${model}`}</div><span className="text-[10px] font-black text-emerald-500">{sourceLabel(row)}</span></div>
    {row.generation ? <div className="mt-1 text-[11px] font-bold text-[var(--ac-muted)]">Поколение: {row.generation}</div> : null}
    {row.facelift ? <div className="mt-1 text-[11px] font-bold text-[var(--ac-muted)]">Обновление: {row.facelift}</div> : null}
    <div className="mt-2 text-xs font-bold text-[var(--ac-muted)]">{yearRange(row.yearFrom, row.yearTo)}{row.engineCc ? ` · ${compactNumber(row.engineCc)} см³` : ""}{row.fuel ? ` · ${row.fuel}` : ""}</div>
    {(row.powerHp || row.powerKw || row.icePowerKw || row.motorPeakKw || row.systemPowerKw || row.power30MinKw || row.utilizationPowerKw) ? <div className="mt-3 flex flex-wrap gap-2 text-xs font-black">
      {row.powerHp ? <span className="rounded-full bg-[var(--ac-surface-3)] px-2.5 py-1.5">{compactNumber(row.powerHp)} л.с.</span> : null}
      {row.powerKw ? <span className="rounded-full bg-[var(--ac-surface-3)] px-2.5 py-1.5">{compactNumber(row.powerKw)} кВт</span> : null}
      {row.icePowerKw ? <span className="rounded-full bg-[var(--ac-surface-3)] px-2.5 py-1.5">ДВС: {compactNumber(row.icePowerKw)} кВт</span> : null}
      {row.motorPeakKw ? <span className="rounded-full bg-[var(--ac-surface-3)] px-2.5 py-1.5">Электромотор: {compactNumber(row.motorPeakKw)} кВт</span> : null}
      {row.systemPowerKw ? <span className="rounded-full bg-[var(--ac-surface-3)] px-2.5 py-1.5">Система: {compactNumber(row.systemPowerKw)} кВт</span> : null}
      {row.power30MinKw ? <span className="rounded-full bg-[var(--ac-surface-3)] px-2.5 py-1.5">30 мин: {compactNumber(row.power30MinKw)} кВт</span> : null}
      {row.utilizationPowerKw ? <span className="rounded-full bg-[var(--ac-surface-3)] px-2.5 py-1.5">Для утильсбора: {compactNumber(row.utilizationPowerKw)} кВт</span> : null}
    </div> : null}
    {(row.transmission || row.drive) ? <div className="mt-3 text-[11px] font-bold text-[var(--ac-muted)]">{[row.transmission, row.drive].filter(Boolean).join(" · ")}</div> : null}
  </article>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, model: modelSlug } = await params;
  const brand = await resolveCatalogBrandBySlug(slug);
  if (!brand) return {};
  const model = await findBrandModelBySlug(brand.name, modelSlug);
  if (!model) return {};
  const title = `${brand.name} ${model.model} — характеристики и расчёт`;
  const description = `Энциклопедия ${brand.name} ${model.model}: поколения, модификации, мощность и расчёт стоимости с доставкой, таможней и утилизационным сбором.`;
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
  const [model, directory, allVariants, allPowerReferences, facets] = await Promise.all([
    findBrandModelBySlug(brand.name, modelSlug),
    readBrandModelDirectory(brand.name),
    readEncyclopediaKnowledgeVariants(),
    readVehiclePowerKnowledge(),
    readCatalogFacets(),
  ]);
  if (!model) notFound();

  const modelKey = vehicleKnowledgeCompact(model.model);
  const makeKey = vehicleKnowledgeCompact(brand.name);
  const rows = new Map<string, PublicKnowledgeRow>();
  for (const variant of allVariants.filter((item) => item.active !== false && item.modelId === model.id)) {
    const powerHp = positive(variant.powerHp, 2_500);
    const generationMeta = (variant as any).generationMeta as { name?: string; status?: string } | null | undefined;
    const faceliftMeta = (variant as any).faceliftMeta as { name?: string; status?: string } | null | undefined;
    const row: PublicKnowledgeRow = {
      id: variant.id,
      source: variant.sourceType,
      variantName: (variant as any).name,
      generation: variant.generation,
      generationStatus: generationMeta?.status,
      facelift: faceliftMeta?.name,
      faceliftStatus: faceliftMeta?.status,
      yearFrom: variant.yearFrom,
      yearTo: variant.yearTo,
      engineCc: positive(variant.engineCc, 20_000),
      fuel: variant.fuel,
      transmission: variant.transmission,
      drive: variant.drive,
      powertrainKind: variant.powertrainKind,
      powerHp,
      powerKw: positive(variant.powerKw, 4_000) || (variant.sourceType !== "encyclopedia_v2" && powerHp ? Math.round((powerHp / 1.35962) * 100) / 100 : undefined),
      icePowerKw: positive(variant.icePowerKw, 4_000),
      motorPeakKw: positive((variant as any).motorPeakKw, 4_000),
      systemPowerKw: positive((variant as any).systemPowerKw, 4_000),
      power30MinKw: totalThirtyMinute(variant),
      utilizationPowerKw: positive(variant.utilizationPowerKw, 4_000),
      encyclopediaStatus: (variant as any).encyclopediaStatus,
      evidenceOfficial: (variant as any).encyclopediaEvidenceOfficial === true,
    };
    rows.set(knowledgeSignature(row), row);
  }
  for (const reference of allPowerReferences.filter((item) => item.active !== false && vehicleKnowledgeCompact(item.make) === makeKey && vehicleKnowledgeCompact(item.model) === modelKey)) {
    const powerHp = Number(reference.powerHp || 0);
    if (!powerHp) continue;
    const row: PublicKnowledgeRow = {
      id: reference.id,
      source: `power_${reference.confidence}`,
      yearFrom: reference.yearFrom,
      yearTo: reference.yearTo,
      engineCc: positive(reference.engineCc, 20_000),
      fuel: reference.fuel,
      powertrainKind: reference.powertrainKind,
      powerHp,
      powerKw: positive(reference.powerKw, 4_000) || Math.round((powerHp / 1.35962) * 100) / 100,
      icePowerKw: positive(reference.icePowerKw, 4_000),
      power30MinKw: totalThirtyMinute(reference),
      utilizationPowerKw: positive(reference.utilizationPowerKw, 4_000),
    };
    if (!rows.has(knowledgeSignature(row))) rows.set(knowledgeSignature(row), row);
  }
  const knowledgeRows = [...rows.values()].sort((left, right) => Number(right.yearTo || right.yearFrom || 0) - Number(left.yearTo || left.yearFrom || 0) || Number(left.powerHp || 0) - Number(right.powerHp || 0));
  const trustedRows = knowledgeRows.filter(trustedKnowledgeRow);

  const rawMakes = [...new Set([
    brand.name,
    ...(facets.makes || []).filter((make) => catalogBrandMatches(brand, make)),
  ])];
  const results = await Promise.all(rawMakes.map((make) => searchOffers({ make, model: model.model, pageSize: 48, sort: "updatedAt" })));
  const uniqueOffers = new Map<string, any>();
  for (const result of results) {
    for (const offer of (result.items || []) as any[]) {
      if (isCrediblePublicOffer(offer)) uniqueOffers.set(String(offer.id), offer);
    }
  }
  const offers = [...uniqueOffers.values()];
  const grouped = MARKET_ORDER.map((market) => ({ market, offers: offers.filter((offer: any) => offer.market === market) })).filter((group) => group.offers.length);
  const brandFallback = offers.length ? [] : (await searchOffers({ make: rawMakes.join(","), pageSize: 16, sort: "updatedAt" })).items.filter((offer: any) => isCrediblePublicOffer(offer)).slice(0, 12);
  const otherModels = directory.filter((item) => item.id !== model.id).slice(0, 18);
  const canonicalUrl = `https://avtocena.com/cars/brand/${brand.slug}/model/${model.slug}`;
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: `${brand.name} ${model.model}`,
    description: `Характеристики и расчёт стоимости ${brand.name} ${model.model} с доставкой, таможней и утилизационным сбором.`,
    url: canonicalUrl,
    brand: { "@type": "Brand", name: brand.name },
    additionalProperty: [
      model.knowledge.powerHp ? { "@type": "PropertyValue", name: "Мощность", value: rangeText(model.knowledge.powerHp, "л.с.") } : null,
      model.knowledge.powerKw ? { "@type": "PropertyValue", name: "Мощность", value: rangeText(model.knowledge.powerKw, "кВт") } : null,
      model.knowledge.power30MinKw ? { "@type": "PropertyValue", name: "30-минутная мощность", value: rangeText(model.knowledge.power30MinKw, "кВт") } : null,
    ].filter(Boolean),
  };

  const summaryCards = [
    model.knowledge.powerHp ? ["Мощность", rangeText(model.knowledge.powerHp, "л.с.")] : null,
    model.knowledge.powerKw ? ["Мощность", rangeText(model.knowledge.powerKw, "кВт")] : null,
    model.knowledge.power30MinKw ? ["30-минутная", rangeText(model.knowledge.power30MinKw, "кВт")] : null,
    model.knowledge.utilizationPowerKw ? ["Для утильсбора", rangeText(model.knowledge.utilizationPowerKw, "кВт")] : null,
    model.knowledge.engineCc ? ["Объём двигателя", rangeText(model.knowledge.engineCc, "см³")] : null,
  ].filter((item): item is string[] => Boolean(item));

  return <main className="ac-model-catalog-page ac-page-copy min-h-screen overflow-x-hidden bg-[#07080d] text-white">
    <PublicHeader backHref={`/cars/brand/${brand.slug}`} backLabel={brand.name} />
    <section className="mx-auto w-full max-w-[1500px] px-4 py-8 md:px-8 md:py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <nav className="text-xs font-black uppercase tracking-[0.15em] text-[var(--ac-muted)]" aria-label="Хлебные крошки">
        <Link href="/cars" className="hover:text-red-500">Каталог</Link><span className="mx-2">/</span><Link href="/cars/encyclopedia" className="hover:text-red-500">Энциклопедия</Link><span className="mx-2">/</span><Link href={`/cars/brand/${brand.slug}`} className="hover:text-red-500">{brand.name}</Link><span className="mx-2">/</span><span>{model.model}</span>
      </nav>

      <header className="mt-5 grid gap-6 rounded-[2rem] bg-[var(--ac-surface)] p-5 md:grid-cols-[170px_minmax(0,1fr)] md:items-center md:p-8">
        <div className="flex h-32 items-center justify-center rounded-[1.5rem] bg-[var(--ac-surface-2)] md:h-40"><BrandLogoVisual brand={brand.name} className="!h-20 !w-32 md:!h-24 md:!w-36" /></div>
        <div className="min-w-0">
          <div className="text-xs font-black uppercase tracking-[0.18em] text-red-500">Модель автомобиля</div>
          <h1 className="mt-2 break-words text-4xl font-black leading-[.98] tracking-[-0.045em] md:text-6xl">{brand.name} {model.model}</h1>
          <p className="mt-4 max-w-4xl text-sm font-medium leading-7 text-[var(--ac-muted)] md:text-base">Поколения, модификации и характеристики {brand.name} {model.model}, а также доступные автомобили и расчёт стоимости под ключ.</p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs font-black">
            <span className="rounded-full bg-[var(--ac-surface-2)] px-3 py-2">{model.count ? `${model.count} предложений` : "Под заказ"}</span>
            <span className="rounded-full bg-[var(--ac-surface-2)] px-3 py-2">Выпуск: {yearRange(model.yearFrom, model.yearTo)}</span>
            {model.knowledge.powerHp ? <span className="rounded-full bg-[var(--ac-surface-2)] px-3 py-2">{rangeText(model.knowledge.powerHp, "л.с.")}</span> : null}
            {model.knowledge.power30MinKw ? <span className="rounded-full bg-[var(--ac-surface-2)] px-3 py-2">30 мин: {rangeText(model.knowledge.power30MinKw, "кВт")}</span> : null}
          </div>
          <button type="button" data-model-lead className="avto-button mt-5 inline-flex min-h-12 items-center rounded-2xl px-5 font-black">Рассчитать {brand.name} {model.model}</button>
        </div>
      </header>

      <section className="mt-7 rounded-[1.8rem] bg-[var(--ac-surface)] p-5 md:p-7">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.16em] text-red-500">Технические характеристики</div>
            <h2 className="mt-1 text-2xl font-black md:text-4xl">Характеристики {brand.name} {model.model}</h2>
          </div>
        </div>
        <p className="mt-3 max-w-5xl text-sm font-medium leading-6 text-[var(--ac-muted)]">Доступные сведения о двигателях, мощности, трансмиссии и приводе. Для электромобилей отдельно указана 30-минутная мощность, используемая при расчёте утилизационного сбора.</p>
        <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
          {summaryCards.map(([label, value]) => <div key={`${label}-${value}`} className="rounded-2xl bg-[var(--ac-surface-2)] p-3"><div className="text-[10px] font-black uppercase tracking-wide text-[var(--ac-muted)]">{label}</div><div className="mt-1 text-lg font-black">{value}</div></div>)}
        </div>
        {trustedRows.length ? <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {trustedRows.map((row) => <TrustedSpecCard key={row.id} row={row} brand={brand.name} model={model.model} />)}
        </div> : <p className="mt-5 rounded-2xl bg-[var(--ac-surface-2)] p-4 text-sm font-bold text-[var(--ac-muted)]">Характеристики этой модели дополняются. Оставьте заявку, и менеджер уточнит параметры нужной модификации.</p>}
      </section>

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
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">{otherModels.map((item) => <Link key={item.id} href={`/cars/brand/${brand.slug}/model/${item.slug}`} className="flex items-center justify-between gap-2 rounded-2xl bg-[var(--ac-surface-2)] px-3 py-3 text-sm font-black hover:text-red-500"><span className="truncate">{item.model}</span><span className="shrink-0 text-[10px] text-[var(--ac-muted)]">{item.knowledge.records || item.count || "—"}</span></Link>)}</div>
      </section> : null}
    </section>
  </main>;
}
