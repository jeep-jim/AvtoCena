import { readGreenCorner, publicGreenOffer } from "@/lib/catalog/green-corner";
import { applyActiveBusinessPricingBatch } from "@/lib/catalog/live-business-pricing";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import HomePageClient from "@/components/home/HomePageClient";
import { readHomeCatalogSnapshot } from "@/lib/catalog/storage";
import styles from "./home.module.css";

export const dynamic = "force-dynamic";

function first(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value || "";
}

function cleanCity(value: string) {
  return value.trim().replace(/[<>"']/g, "").slice(0, 80);
}

function decodeCity(value: string) {
  try { return cleanCity(decodeURIComponent(value)); } catch { return cleanCity(value); }
}

export async function generateMetadata({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }): Promise<Metadata> {
  const params = (await searchParams) || {};
  const city = cleanCity(first(params.city));
  const title = city ? `Цена на авто под заказ в ${city} — АвтоЦена` : "АвтоЦена — авто на заказ под ваш бюджет, авторасчёт под ключ";
  const description = city
    ? `Автомобили под заказ с расчётом стоимости и доставкой в ${city}. Предложения из Японии, Китая, Кореи, ОАЭ, Европы и Грузии.`
    : "Узнайте, какой автомобиль можно привезти под ваш бюджет и сколько он будет стоить под ключ в России.";
  const canonical = city ? `/?city=${encodeURIComponent(city)}` : "/";
  const openGraphUrl = city ? `https://avtocena.com/?city=${encodeURIComponent(city)}` : "https://avtocena.com";
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: openGraphUrl, type: "website" },
    verification: { google: "fKoSCYRhUlLSknjTU-ak0YWhATWdUCZLyVLCv5N0te8" },
  };
}

export default async function HomePage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = (await searchParams) || {};
  const cookieStore = await cookies();
  const fromQuery = cleanCity(first(params.city));
  const fromCookie = decodeCity(cookieStore.get("avtocena_city")?.value || "");
  const catalog = await readHomeCatalogSnapshot(10).catch((error) => {
    console.error("home_initial_catalog_failed", error);
    return { items: [], marketCounts: {}, total: 0 };
  });
  const green = await readGreenCorner().catch(()=>null);
  const greenItems = await applyActiveBusinessPricingBatch((green?.items || []).slice(0,10).map(publicGreenOffer));
  const pricedItems = await applyActiveBusinessPricingBatch(catalog.items).catch((error) => {
    console.error("home_initial_pricing_failed", error);
    // Preserve the last audited quote if settings storage is temporarily down.
    return catalog.items;
  });
  return <>
    <div className={styles.scope}>
      <HomePageClient
        initialGreen={{items:greenItems,total:green?.items.length || 0}}
        initialCity={fromQuery || fromCookie}
        initialOffers={pricedItems}
        initialMarketCounts={catalog.marketCounts}
        initialCount={catalog.total}
      />
    </div>
    <style dangerouslySetInnerHTML={{ __html: "@media (min-width:1024px){.ac-budget-help{display:none!important}}" }} />
  </>;
}
