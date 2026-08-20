import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandLogoVisual } from "@/components/catalog/BrandLogoRail";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { VehicleSpecifications } from "@/components/catalog/VehicleSpecifications";
import { resolveCatalogBrandBySlug } from "@/lib/catalog/catalog-brand-directory";
import { readPublicEncyclopediaVariants, encyclopediaSourceLabel, encyclopediaVariantTitle } from "@/lib/catalog/encyclopedia-public";
import { findBrandModelBySlug } from "@/lib/catalog/model-directory";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = { params: Promise<{ slug: string; model: string; variant: string }> };

async function resolveModification(params: PageProps["params"]) {
  const { slug, model: modelSlug, variant: variantSlug } = await params;
  const brand = await resolveCatalogBrandBySlug(slug);
  if (!brand) return null;
  const model = await findBrandModelBySlug(brand.name, modelSlug);
  if (!model) return null;
  const variants = await readPublicEncyclopediaVariants(model.id);
  const variant = variants.find((row) => row.slug === variantSlug);
  if (!variant) return null;
  return { brand, model, variant, variants };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const resolved = await resolveModification(params);
  if (!resolved) return {};
  const { brand, model, variant } = resolved;
  const variantTitle = encyclopediaVariantTitle(variant, `${brand.name} ${model.model}`);
  const title = `${brand.name} ${model.model} ${variantTitle} — технические характеристики`;
  const description = `Подтверждённые характеристики ${brand.name} ${model.model}: ${variantTitle}. Двигатель, мощность, трансмиссия, привод и данные для расчёта утилизационного сбора.`;
  const canonical = `/cars/brand/${brand.slug}/model/${model.slug}/modification/${variant.slug}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: "website" },
  };
}

export default async function EncyclopediaModificationPage({ params }: PageProps) {
  const resolved = await resolveModification(params);
  if (!resolved) notFound();
  const { brand, model, variant, variants } = resolved;
  const variantTitle = encyclopediaVariantTitle(variant, `${brand.name} ${model.model}`);
  const siblings = variants.filter((row) => row.id !== variant.id).slice(0, 8);

  return <main className="ac-page-copy min-h-screen overflow-x-hidden bg-[#07080d] text-white">
    <PublicHeader backHref={`/cars/brand/${brand.slug}/model/${model.slug}`} backLabel={`${brand.name} ${model.model}`} />
    <section className="mx-auto w-full max-w-[1500px] px-4 py-8 md:px-8 md:py-12">
      <nav className="text-xs font-black uppercase tracking-[0.15em] text-[var(--ac-muted)]" aria-label="Хлебные крошки">
        <Link href="/cars" className="hover:text-red-500">Каталог</Link><span className="mx-2">/</span>
        <Link href="/cars/encyclopedia" className="hover:text-red-500">Энциклопедия</Link><span className="mx-2">/</span>
        <Link href={`/cars/brand/${brand.slug}`} className="hover:text-red-500">{brand.name}</Link><span className="mx-2">/</span>
        <Link href={`/cars/brand/${brand.slug}/model/${model.slug}`} className="hover:text-red-500">{model.model}</Link><span className="mx-2">/</span>
        <span>Модификация</span>
      </nav>

      <header className="mt-5 grid gap-6 rounded-[2rem] bg-[var(--ac-surface)] p-5 md:grid-cols-[170px_minmax(0,1fr)] md:items-center md:p-8">
        <div className="flex h-32 items-center justify-center rounded-[1.5rem] bg-[var(--ac-surface-2)] md:h-40">
          <BrandLogoVisual brand={brand.name} className="!h-20 !w-32 md:!h-24 md:!w-36" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-black uppercase tracking-[0.18em] text-red-500">Модификация автомобиля</div>
          <h1 className="mt-2 break-words text-3xl font-black leading-[1.02] tracking-[-0.04em] md:text-5xl">{brand.name} {model.model}</h1>
          <div className="mt-2 text-xl font-black text-[var(--ac-text)] md:text-2xl">{variantTitle}</div>
          <div className="mt-4 flex flex-wrap gap-2 text-xs font-black">
            {variant.generation ? <span className="rounded-full bg-[var(--ac-surface-2)] px-3 py-2">{variant.generation}</span> : null}
            {variant.facelift ? <span className="rounded-full bg-[var(--ac-surface-2)] px-3 py-2">{variant.facelift}</span> : null}
            <span className="rounded-full bg-[var(--ac-surface-2)] px-3 py-2 text-emerald-500">{encyclopediaSourceLabel(variant)}</span>
          </div>
        </div>
      </header>

      <section className="mt-7 rounded-[1.8rem] bg-[var(--ac-surface)] p-5 md:p-7">
        <div className="text-xs font-black uppercase tracking-[0.16em] text-red-500">Технические характеристики</div>
        <h2 className="mt-1 text-2xl font-black md:text-4xl">{variantTitle}</h2>
        <p className="mt-3 max-w-5xl text-sm font-medium leading-6 text-[var(--ac-muted)]">Показываем только те характеристики, которые уже присутствуют в проверяемой базе АвтоЦены. Неизвестные размеры, массы и другие параметры не подставляются предположениями.</p>
        <div className="mt-6"><VehicleSpecifications row={variant} title={`${brand.name} ${model.model}`} mode="full" /></div>
      </section>

      <section className="mt-7 grid gap-4 rounded-[1.8rem] bg-[var(--ac-surface)] p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:p-7">
        <div>
          <h2 className="text-2xl font-black md:text-3xl">Найти {brand.name} {model.model}</h2>
          <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-[var(--ac-muted)]">Откройте актуальные предложения этой модели на доступных рынках или получите расчёт автомобиля под ключ.</p>
        </div>
        <div className="flex flex-wrap gap-2 md:justify-end">
          <Link href={`/cars?make=${encodeURIComponent(brand.name)}&model=${encodeURIComponent(model.model)}`} className="rounded-2xl bg-[var(--ac-surface-2)] px-5 py-3 text-sm font-black">Смотреть предложения</Link>
          <Link href="/#form" className="avto-button rounded-2xl px-5 py-3 text-sm font-black">Рассчитать автомобиль</Link>
        </div>
      </section>

      {siblings.length ? <section className="mt-10">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-2xl font-black md:text-3xl">Другие модификации {brand.name} {model.model}</h2>
          <Link href={`/cars/brand/${brand.slug}/model/${model.slug}`} className="text-sm font-black">Все →</Link>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {siblings.map((row) => <Link key={row.id} href={`/cars/brand/${brand.slug}/model/${model.slug}/modification/${row.slug}`} className="rounded-2xl bg-[var(--ac-surface)] p-4 font-black hover:text-red-500">
            <div className="text-sm">{encyclopediaVariantTitle(row, `${brand.name} ${model.model}`)}</div>
            <div className="mt-2 text-[11px] font-bold text-[var(--ac-muted)]">{row.generation || "Поколение уточняется"}</div>
          </Link>)}
        </div>
      </section> : null}
    </section>
  </main>;
}
