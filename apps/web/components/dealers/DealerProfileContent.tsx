import Link from "next/link";
import type {DealerShowcase} from "@/lib/dealers/showcase-model";
import type {ComponentProps} from "react";
import {BuyerGallery} from "@/components/home/BuyerGallery";
import {SpecialRail} from "./SpecialRail";
import {DealerMap} from "./DealerMap";
export function DealerProfileContent({s,preview=false,items=[]}:{s:DealerShowcase;preview?:boolean;items?:ComponentProps<typeof SpecialRail>["items"]}){
 return <>
      <div className="dealer-profile mx-auto max-w-6xl px-4 pb-10 pt-4">
        {preview && (
          <p className="mb-4 rounded-xl bg-amber-500/15 p-3">
            Предпросмотр владельца ·{" "}
            {s.profileEnabled
              ? "Страница включена"
              : "Страница скрыта от посетителей"}
          </p>
        )}
        <div className={s.banner ? "dealer-profile-hero" : ""}>
        {s.banner && (
          <img
            src={s.banner}
            alt={s.name}
            className="aspect-[3/1] w-full rounded-2xl object-contain bg-neutral-950"
          />
        )}
        <section className="dealer-profile-identity flex flex-wrap items-center gap-3">
          {s.logoLight && (
            <img
              src={s.logoLight}
              alt={s.name}
              className="dealer-logo-light h-12 w-28 object-contain"
            />
          )}
          {s.logoDark && (
            <img
              src={s.logoDark}
              alt={s.name}
              className="dealer-logo-dark h-12 w-28 object-contain"
            />
          )}
          <div>
            <h1 className="text-2xl font-black md:text-3xl">{s.name}</h1>
            <p className="mt-2 text-[var(--ac-muted)]">
              {[...new Set(s.offices.map((o) => o.city))].join(" · ")}
            </p>
          </div>
        </section>
        </div>
        {s.offices.flatMap((o) => o.photos).length > 0 && (
          <BuyerGallery
            title="Наши офисы"
            dealerName={s.name}
            images={s.offices.flatMap((o) => o.photos.map((p) => p.url))}
          />
        )}
        {s.description && <p className="my-4 whitespace-pre-line text-sm leading-relaxed">
          {s.description}
        </p>}
        {(s.phone || s.telegram || s.max) && <div className="my-3 flex flex-wrap gap-2">
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
        </div>}
        <div className="dealer-profile-offices">
        <div className="grid content-start gap-3">
          {s.offices.map((o) => (
            <section
              key={o.id}
              className="rounded-2xl border border-[var(--ac-border)] bg-[var(--ac-surface)] p-4"
            >
              <h2 className="text-base font-bold">{o.city}</h2>
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
        </div>
        {s.buyersEnabled && (
          <BuyerGallery
            title="Наши покупатели"
            dealerName={s.name}
            images={s.buyerPhotos.map((p) => p.url)}
          />
        )}
        <SpecialRail heading={s.specialHeading} items={items} />
        <Link className="mt-5 inline-block text-sm text-red-500" href="/cars">
          Перейти в каталог →
        </Link>
      </div>
      <style>{`.dealer-profile-hero{display:grid;grid-template-columns:minmax(0,2.4fr) minmax(220px,1fr);gap:20px;align-items:center}.dealer-profile-identity{padding:12px 0}.dealer-profile-offices{display:grid;grid-template-columns:minmax(240px,1fr) minmax(0,1.7fr);gap:16px;margin-top:20px;align-items:start}.dealer-profile-offices>section{margin-top:0}.dealer-profile>section{margin-top:20px}.dealer-profile>section>h2{font-size:24px;line-height:1.2;white-space:normal}.dealer-profile .ac-buyers-rail>button{height:132px;width:192px}@media(max-width:700px){.dealer-profile-hero,.dealer-profile-offices{grid-template-columns:minmax(0,1fr);gap:12px}.dealer-profile-identity{padding:0}.dealer-profile>section>h2{font-size:20px}}.dealer-logo-light{display:none}html[data-theme="light"] .dealer-logo-light{display:block}html[data-theme="light"] .dealer-logo-dark{display:none}`}</style>
 </>;
}
