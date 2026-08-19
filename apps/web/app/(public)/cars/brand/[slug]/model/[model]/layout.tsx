import type { ReactNode } from "react";
import Link from "next/link";
import { resolveCatalogBrandBySlug } from "@/lib/catalog/catalog-brand-directory";
import { findBrandModelBySlug } from "@/lib/catalog/model-directory";
import { findVehicleModelMedia } from "@/lib/catalog/model-media";
import { readVehicleKnowledgeVariants } from "@/lib/catalog/vehicle-knowledge";

type LayoutProps = {
  children: ReactNode;
  params: Promise<{ slug: string; model: string }>;
};

function compact(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values: unknown[]) {
  return [...new Set(values.map(compact).filter(Boolean))];
}

function yearRange(from?: number, to?: number) {
  if (from && to) return from === to ? String(from) : `${from}–${to}`;
  if (from) return `с ${from}`;
  if (to) return `до ${to}`;
  return "актуальные поколения";
}

function faqJsonLd(make: string, model: string, years: string, engines: string[], powers: number[]) {
  const powerText = powers.length
    ? powers.length === 1
      ? `${powers[0]} л.с.`
      : `${Math.min(...powers)}–${Math.max(...powers)} л.с.`
    : "зависит от выбранной модификации";
  const engineText = engines.length ? engines.slice(0, 8).join(", ") : "зависит от поколения и рынка";
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: `Какие характеристики у ${make} ${model}?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `${make} ${model} выпускался в период ${years}. Доступные двигатели: ${engineText}. Мощность: ${powerText}. Точные параметры определяются по году, поколению и модификации.`,
        },
      },
      {
        "@type": "Question",
        name: `Можно ли рассчитать ${make} ${model} под ключ?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `Да. АвтоЦена рассчитывает стоимость ${make} ${model} с учётом цены автомобиля, доставки, таможенных платежей, утилизационного сбора и оформления.`,
        },
      },
      {
        "@type": "Question",
        name: `Откуда берутся фотографии ${make} ${model}?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: "Фотографии модели и поколения берутся из подтверждённых каталогов и показывают внешний вид кузова. Фотографии конкретного продаваемого автомобиля всегда отображаются отдельно в его объявлении.",
        },
      },
    ],
  };
}

export default async function ModelSeoLayout({ children, params }: LayoutProps) {
  const { slug, model: modelSlug } = await params;
  const brand = await resolveCatalogBrandBySlug(slug);
  if (!brand) return children;
  const model = await findBrandModelBySlug(brand.name, modelSlug);
  if (!model) return children;

  const [media, allVariants] = await Promise.all([
    findVehicleModelMedia(model.id),
    readVehicleKnowledgeVariants(),
  ]);
  const variants = allVariants.filter((row) => row.active !== false && row.modelId === model.id);
  const engines = unique(variants.map((row) => row.engineCc ? `${row.engineCc} см³` : row.powertrainKind));
  const fuels = unique(variants.map((row) => row.fuel));
  const drives = unique(variants.map((row) => row.drive));
  const powers = variants.map((row) => Number(row.powerHp || 0)).filter((value) => Number.isFinite(value) && value > 0);
  const years = yearRange(model.yearFrom, model.yearTo);
  const faq = faqJsonLd(brand.name, model.model, years, engines, powers);

  return <>
    {children}
    <section className="ac-model-seo-copy ac-page-copy mx-auto w-full max-w-[1500px] px-4 pb-14 text-[var(--ac-text)] md:px-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faq) }} />

      {media?.images?.length ? <section className="rounded-[1.8rem] bg-[var(--ac-surface)] p-5 md:p-7" aria-labelledby="model-gallery-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.16em] text-red-500">Фото модели</div>
            <h2 id="model-gallery-title" className="mt-1 text-2xl font-black text-[var(--ac-text)] md:text-4xl">Как выглядит {brand.name} {model.model}</h2>
          </div>
          <span className="text-xs font-bold text-[var(--ac-muted)]">{media.generation ? `${media.generation} · ` : ""}{yearRange(media.yearFrom, media.yearTo)}</span>
        </div>
        <p className="mt-3 max-w-4xl text-sm font-medium leading-6 text-[var(--ac-muted)]">Фотографии показывают внешний вид модели и поколения. Состояние, цвет и комплектация конкретного автомобиля проверяются по фотографиям его объявления.</p>
        <div className="mt-5 grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-4">
          {media.images.map((image, index) => <figure key={`${image.url}-${index}`} className="overflow-hidden rounded-2xl bg-[var(--ac-surface-2)]">
            <img
              src={image.url}
              alt={image.alt || `${brand.name} ${model.model}${media.generation ? ` ${media.generation}` : ""} — фото ${index + 1}`}
              width={image.width || 1200}
              height={image.height || 800}
              loading="lazy"
              className="aspect-[4/3] h-auto w-full object-cover"
            />
          </figure>)}
        </div>
        <div className="mt-3 text-right"><a href={media.sourceUrl} rel="nofollow noopener noreferrer" target="_blank" className="text-xs font-bold text-[var(--ac-muted)] hover:text-red-500">Источник фотографий</a></div>
      </section> : null}

      <section className="mt-7 rounded-[1.8rem] bg-[var(--ac-surface)] p-5 md:p-7" aria-labelledby="model-description-title">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] lg:items-start">
          <div className="min-w-0">
            <div className="text-xs font-black uppercase tracking-[0.16em] text-red-500">Описание и характеристики</div>
            <h2 id="model-description-title" className="mt-1 text-2xl font-black text-[var(--ac-text)] md:text-4xl">{brand.name} {model.model}: характеристики и расчёт стоимости</h2>
            <div className="mt-4 space-y-3 text-sm font-medium leading-7 text-[var(--ac-muted)]">
              <p>На странице собраны годы выпуска, поколения, двигатели и подтверждённые значения мощности {brand.name} {model.model}. Эти данные помогают выбрать подходящую модификацию и заранее оценить возможность привоза автомобиля.</p>
              <p>Стоимость под ключ рассчитывается с учётом рынка покупки, цены автомобиля, возраста, объёма и мощности двигателя, доставки, таможенных платежей и утилизационного сбора.</p>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl bg-[var(--ac-surface-2)] p-3"><div className="text-[10px] font-black uppercase tracking-wide text-[var(--ac-muted)]">Годы выпуска</div><div className="mt-1 text-base font-black text-[var(--ac-text)]">{years}</div></div>
              {powers.length ? <div className="rounded-2xl bg-[var(--ac-surface-2)] p-3"><div className="text-[10px] font-black uppercase tracking-wide text-[var(--ac-muted)]">Мощность</div><div className="mt-1 text-base font-black text-[var(--ac-text)]">{Math.min(...powers)}{Math.max(...powers) !== Math.min(...powers) ? `–${Math.max(...powers)}` : ""} л.с.</div></div> : null}
              {fuels.length ? <div className="rounded-2xl bg-[var(--ac-surface-2)] p-3"><div className="text-[10px] font-black uppercase tracking-wide text-[var(--ac-muted)]">Тип топлива</div><div className="mt-1 text-base font-black text-[var(--ac-text)]">{fuels.slice(0, 3).join(" · ")}</div></div> : null}
              {drives.length ? <div className="rounded-2xl bg-[var(--ac-surface-2)] p-3"><div className="text-[10px] font-black uppercase tracking-wide text-[var(--ac-muted)]">Привод</div><div className="mt-1 text-base font-black text-[var(--ac-text)]">{drives.slice(0, 3).join(" · ")}</div></div> : null}
            </div>
          </div>

          <aside className="rounded-2xl bg-[var(--ac-surface-2)] p-4 md:p-5">
            <div className="text-lg font-black text-[var(--ac-text)]">Подобрать {brand.name} {model.model}</div>
            <p className="mt-2 text-sm font-medium leading-6 text-[var(--ac-muted)]">Получите расчёт под ключ или откройте доступные предложения этой модели.</p>
            <div className="mt-5 grid gap-3">
              <button type="button" data-model-lead className="avto-button inline-flex min-h-12 items-center justify-center rounded-2xl px-5 text-center font-black">Рассчитать {brand.name} {model.model}</button>
              <Link href={`/cars?make=${encodeURIComponent(brand.name)}&model=${encodeURIComponent(model.model)}`} className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-[var(--ac-surface-3)] px-5 text-center font-black text-[var(--ac-text)] hover:text-red-500">Смотреть предложения</Link>
            </div>
          </aside>
        </div>
      </section>
    </section>
  </>;
}
