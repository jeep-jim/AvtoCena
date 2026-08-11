import type { Metadata } from "next";
import { cookies } from "next/headers";
import HomePageClient from "@/components/home/HomePageClient";
import { PUBLIC_CATALOG_MARKETS } from "@/lib/catalog/runtime-config";
import { searchOffers } from "@/lib/catalog/storage";
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

async function loadInitialCatalog() {
  const markets = await Promise.all(PUBLIC_CATALOG_MARKETS.map(async (market) => {
    try {
      const result = await searchOffers({ market, page: 1, pageSize: 6, sort: "updatedAt" });
      return { market, total: Number(result.total || 0), items: result.items || [] };
    } catch {
      return { market, total: 0, items: [] as any[] };
    }
  }));

  return {
    offers: markets.flatMap((market) => market.items),
    marketCounts: Object.fromEntries(markets.map((market) => [market.market, market.total])),
    total: markets.reduce((sum, market) => sum + market.total, 0),
  };
}

export async function generateMetadata({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }): Promise<Metadata> {
  const params = (await searchParams) || {};
  const city = cleanCity(first(params.city));
  const title = city ? `Цена на авто под заказ в ${city} — АвтоЦена` : "АвтоЦена — авто под ваш бюджет за 30 секунд";
  const description = city
    ? `Автомобили под заказ с расчётом стоимости и доставкой в ${city}. Предложения из Японии, Китая, Кореи, ОАЭ, Европы, Грузии и Кыргызстана.`
    : "Узнайте, какой автомобиль можно привезти под ваш бюджет и сколько он будет стоить под ключ в России.";
  const canonical = city ? `/?city=${encodeURIComponent(city)}` : "/";
  const openGraphUrl = city ? `https://avtocena.com/?city=${encodeURIComponent(city)}` : "https://avtocena.com";
  return { title, description, alternates: { canonical }, openGraph: { title, description, url: openGraphUrl, type: "website" } };
}

export default async function HomePage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = (await searchParams) || {};
  const cookieStore = await cookies();
  const fromQuery = cleanCity(first(params.city));
  const fromCookie = decodeCity(cookieStore.get("avtocena_city")?.value || "");
  const initialCatalog = await loadInitialCatalog();
  return <>
    <div className={styles.scope}><HomePageClient initialCity={fromQuery || fromCookie} initialOffers={initialCatalog.offers} initialMarketCounts={initialCatalog.marketCounts} initialCount={initialCatalog.total} /></div>
    <style dangerouslySetInnerHTML={{ __html: "@media (min-width:1024px){.ac-budget-help{display:none!important}}" }} />
  </>;
}
