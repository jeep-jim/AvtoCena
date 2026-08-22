import type { Metadata } from "next";
import type { ReactNode } from "react";
import { OfferSpecGridStabilizer } from "@/components/catalog/OfferSpecGridStabilizer";
import { money } from "@/lib/avtocena";
import { absoluteAvtocenaUrl, catalogOfferUrl } from "@/lib/ai-discovery";
import { getOfferForPage } from "@/lib/catalog/offer-page-data";
import { publicCatalogPowerHp } from "@/lib/catalog/power-sanity";
import { presentCatalogOffer } from "@/lib/catalog/presentation";
import { catalogMarketLabel } from "@/lib/catalog/runtime-config";

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function offerStructuredData(id: string, offer: any) {
  const presented = presentCatalogOffer(offer);
  const make = clean(presented.makeLabel || offer.make);
  const model = clean(presented.modelLabel || offer.model);
  const displayTitle = clean(presented.title) || [make, model, offer.trim, offer.year].filter(Boolean).join(" ");
  const canonical = catalogOfferUrl(id);
  const totalRub = Number(offer.totalRub || 0);
  const mileageKm = Number(offer.mileageKm || 0);
  const engineCc = Number(offer.engineCc || 0);
  const safePowerHp = publicCatalogPowerHp(offer);
  const images = Array.isArray(offer.images)
    ? offer.images.map((image: any) => absoluteAvtocenaUrl(image?.url)).filter(Boolean).slice(0, 12)
    : [];

  return {
    "@context": "https://schema.org",
    "@type": "Car",
    "@id": canonical,
    url: canonical,
    name: displayTitle,
    image: images.length ? images : undefined,
    brand: make ? { "@type": "Brand", name: make } : undefined,
    model: model || undefined,
    vehicleModelDate: offer.year ? String(offer.year) : undefined,
    vehicleConfiguration: clean(offer.trim || offer.generation) || undefined,
    fuelType: clean(offer.fuel) || undefined,
    vehicleTransmission: clean(offer.transmission) || undefined,
    bodyType: clean(offer.bodyType) || undefined,
    driveWheelConfiguration: clean(offer.drive) || undefined,
    vehicleEngine: engineCc > 0 || safePowerHp ? {
      "@type": "EngineSpecification",
      engineDisplacement: engineCc > 0 ? { "@type": "QuantitativeValue", value: Math.round(engineCc), unitCode: "CMQ" } : undefined,
      enginePower: safePowerHp ? { "@type": "QuantitativeValue", value: safePowerHp, unitText: "hp" } : undefined,
    } : undefined,
    mileageFromOdometer: mileageKm > 0 ? {
      "@type": "QuantitativeValue",
      value: Math.round(mileageKm),
      unitCode: "KMT",
    } : undefined,
    offers: totalRub > 0 ? {
      "@type": "Offer",
      url: canonical,
      price: Math.round(totalRub),
      priceCurrency: "RUB",
      availability: "https://schema.org/InStock",
      seller: {
        "@type": "Organization",
        name: "АвтоЦена",
        url: "https://avtocena.com",
      },
    } : undefined,
  };
}

function safeJsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const offer = await getOfferForPage(id);
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

export default async function OfferLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const offer = await getOfferForPage(id);
  const structuredData = offer ? offerStructuredData(id, offer) : null;

  return <>
    {structuredData ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(structuredData) }} /> : null}
    <style dangerouslySetInnerHTML={{ __html: `
      html body .ac-offer-page .ac-offer-spec-grid{display:flex!important;flex-wrap:wrap!important;gap:10px!important;grid-template-columns:none!important;grid-auto-flow:row!important}
      html body .ac-offer-page .ac-offer-spec-grid>.ac-offer-spec-tile{flex:0 0 calc(50% - 5px)!important;width:calc(50% - 5px)!important;max-width:calc(50% - 5px)!important;grid-column:auto!important}
      html body .ac-offer-page .ac-offer-spec-grid>.ac-offer-spec-tile:last-child:nth-child(odd){flex-basis:100%!important;width:100%!important;max-width:100%!important}
    ` }} />
    {children}
    <OfferSpecGridStabilizer />
  </>;
}
