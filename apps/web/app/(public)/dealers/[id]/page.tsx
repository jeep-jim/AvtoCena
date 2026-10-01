import {dealerProfilePath} from '@/lib/dealers/profile-url';
import {withDealerRate} from '@/lib/dealers/exchange-rate';
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { readShowcase } from "@/lib/dealers/showcase-store";
import { publicRail } from "@/lib/dealers/public-showcase";
import { BuyerGallery } from "@/components/home/BuyerGallery";
import { SpecialRail } from "@/components/dealers/SpecialRail";
import { DealerMap } from "@/components/dealers/DealerMap";
import { PublicHeader } from "@/components/layout/PublicHeader";
export const dynamic = "force-dynamic";
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const s = await readShowcase((await params).id);
  if (!s?.profileEnabled || (await searchParams).preview)
    return {
      title: "Дилер — АвтоЦена",
      robots: { index: false, follow: false },
    };
  return {
    title: `${s.name} — дилер на АвтоЦена`,
    description: s.description.slice(0, 200),
    alternates: { canonical: dealerProfilePath(s) },
  };
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  let s = await readShowcase((await params).id);
  const preview =
    (await searchParams).preview === "1" &&
    (await getCurrentUser())?.role === "owner";
  if (!s || (!s.profileEnabled && !preview)) notFound();
  if(s.specialsEnabled)s=await withDealerRate(s);
  return (
    <main className="ac-page-copy min-h-screen bg-[var(--ac-bg)] text-[var(--ac-text)]">
      <PublicHeader backHref="/" backLabel="На главную" />
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-6">
        {preview && (
          <p className="mb-4 rounded-xl bg-amber-500/15 p-3">
            Предпросмотр владельца ·{" "}
            {s.profileEnabled
              ? "Страница включена"
              : "Страница скрыта от посетителей"}
          </p>
        )}
        {s.banner && (
          <img
            src={s.banner}
            alt={s.name}
            className="aspect-[3/1] w-full rounded-3xl object-cover"
          />
        )}
        <section className="my-6 flex flex-wrap items-center gap-5">
          {s.logoLight && (
            <img
              src={s.logoLight}
              alt={s.name}
              className="dealer-logo-light h-20 w-40 object-contain"
            />
          )}
          {s.logoDark && (
            <img
              src={s.logoDark}
              alt={s.name}
              className="dealer-logo-dark h-20 w-40 object-contain"
            />
          )}
          <div>
            <h1 className="text-3xl font-black md:text-5xl">{s.name}</h1>
            <p className="mt-2 text-[var(--ac-muted)]">
              {[...new Set(s.offices.map((o) => o.city))].join(" · ")}
            </p>
          </div>
        </section>
        {s.offices.flatMap((o) => o.photos).length > 0 && (
          <BuyerGallery
            title="Наши офисы"
            dealerName={s.name}
            images={s.offices.flatMap((o) => o.photos.map((p) => p.url))}
          />
        )}
        <p className="my-6 whitespace-pre-line leading-relaxed">
          {s.description}
        </p>
        <div className="flex flex-wrap gap-3">
          {s.phone && (
            <a
              className="rounded-xl bg-red-600 px-5 py-3 font-bold text-white"
              href={`tel:${s.phone.replace(/[^+\d]/g, "")}`}
            >
              {s.phone}
            </a>
          )}
          {s.telegram && (
            <a
              className="rounded-xl border border-[var(--ac-border)] px-5 py-3"
              href={s.telegram}
              target="_blank"
              rel="noreferrer"
            >
              Telegram
            </a>
          )}
          {s.max && (
            <a
              className="rounded-xl border border-[var(--ac-border)] px-5 py-3"
              href={s.max}
              target="_blank"
              rel="noreferrer"
            >
              MAX
            </a>
          )}
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {s.offices.map((o) => (
            <section
              key={o.id}
              className="rounded-2xl border border-[var(--ac-border)] p-5"
            >
              <h2 className="text-xl font-black">{o.city}</h2>
              <p className="mt-2">{o.address}</p>
              {o.hours && (
                <p className="mt-2 text-sm text-[var(--ac-muted)]">{o.hours}</p>
              )}
              {o.phone && (
                <a
                  className="mt-2 block"
                  href={`tel:${o.phone.replace(/[^+\d]/g, "")}`}
                >
                  {o.phone}
                </a>
              )}
              <a
                className="mt-3 inline-block text-red-500 underline"
                href={`https://yandex.ru/maps/?text=${encodeURIComponent(`${o.city}, ${o.address}`)}`}
                target="_blank"
                rel="noreferrer"
              >
                Построить маршрут ↗
              </a>
            </section>
          ))}
        </div>
        <DealerMap offices={s.offices} />
        {s.buyersEnabled && (
          <BuyerGallery
            dealerName={s.name}
            images={s.buyerPhotos.map((p) => p.url)}
          />
        )}
        <SpecialRail heading={s.specialHeading} items={publicRail(s)} />
        <Link className="mt-8 inline-block text-red-500" href="/cars">
          Перейти в каталог →
        </Link>
      </div>
      <style>{`.dealer-logo-light{display:none}html[data-theme="light"] .dealer-logo-light{display:block}html[data-theme="light"] .dealer-logo-dark{display:none}`}</style>
    </main>
  );
}
