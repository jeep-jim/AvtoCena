import type { ReactNode } from "react";
import { resolveCatalogBrandBySlug } from "@/lib/catalog/catalog-brand-directory";
import { findBrandModelBySlug } from "@/lib/catalog/model-directory";
import { findVehicleModelMedia } from "@/lib/catalog/model-media";

type LayoutProps = {
  children: ReactNode;
  params: Promise<{ slug: string; model: string }>;
};

function yearRange(from?: number, to?: number) {
  if (from && to) return from === to ? String(from) : `${from}–${to}`;
  if (from) return `с ${from}`;
  if (to) return `до ${to}`;
  return "актуальные поколения";
}

export default async function ModelSeoLayout({ children, params }: LayoutProps) {
  const { slug, model: modelSlug } = await params;
  const brand = await resolveCatalogBrandBySlug(slug);
  if (!brand) return children;
  const model = await findBrandModelBySlug(brand.name, modelSlug);
  if (!model) return children;

  const media = await findVehicleModelMedia(model.id);

  return <>
    {children}
    <section className="ac-model-seo-copy ac-page-copy mx-auto w-full max-w-[1500px] px-4 pb-14 text-[var(--ac-text)] md:px-8">
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
    </section>
  </>;
}
