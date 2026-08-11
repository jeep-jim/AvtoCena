import type { Metadata } from "next";
import type { ReactNode } from "react";
import { OfferSpecGridStabilizer } from "@/components/catalog/OfferSpecGridStabilizer";
import { money } from "@/lib/avtocena";
import { presentCatalogOffer } from "@/lib/catalog/presentation";
import { catalogMarketLabel } from "@/lib/catalog/runtime-config";
import { getOffer } from "@/lib/catalog/storage";

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const offer = await getOffer(id);
  if (!offer) {
    return {
      title: "Автомобиль под заказ — АвтоЦена",
      description: "Каталог автомобилей с полным расчётом стоимости доставки и оформления в России.",
      robots: { index: false, follow: true },
    };
  }

  const presented = presentCatalogOffer(offer);
  const make = clean(presented.makeLabel);
  const model = clean(presented.modelLabel);
  const displayTitle = clean(presented.title) || [make, model].filter(Boolean).join(" ");
  const year = Number(offer.year || 0);
  const title = `${displayTitle}${year ? ` ${year}` : ""} — цена автомобиля под ключ`;
  const totalRub = Number(offer.totalRub || 0);
  const market = catalogMarketLabel(offer.market);
  const priceText = totalRub > 0 ? `${money(totalRub)} ₽` : "рассчитывается";
  const description = `Цена автомобиля ${make} ${model}${year ? ` ${year} года` : ""} из рынка ${market}: ${priceText}. Полный расчёт под ключ включает автомобиль, логистику, таможенные платежи, оформление и доставку по РФ.`;
  const canonical = `/cars/offer/${encodeURIComponent(id)}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "website",
      title,
      description,
      url: canonical,
      images: offer.images?.[0]?.url ? [{ url: offer.images[0].url, alt: displayTitle || `${make} ${model}` }] : undefined,
    },
    robots: { index: true, follow: true },
  };
}

export default function OfferLayout({ children }: { children: ReactNode }) {
  return <>
    <style dangerouslySetInnerHTML={{ __html: `
      html body .ac-offer-page .ac-offer-spec-grid{display:flex!important;flex-wrap:wrap!important;gap:10px!important;grid-template-columns:none!important;grid-auto-flow:row!important}
      html body .ac-offer-page .ac-offer-spec-grid>.ac-offer-spec-tile{flex:0 0 calc(50% - 5px)!important;width:calc(50% - 5px)!important;max-width:calc(50% - 5px)!important;grid-column:auto!important}
      html body .ac-offer-page .ac-offer-spec-grid>.ac-offer-spec-tile:last-child:nth-child(odd){flex-basis:100%!important;width:100%!important;max-width:100%!important}
    ` }} />
    {children}
    <OfferSpecGridStabilizer />
  </>;
}
