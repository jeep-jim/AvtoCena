import {createHomePhaseTiming} from "@/lib/catalog/home-phase-timing";
import {BuyerGallery} from '@/components/home/BuyerGallery';
import {SpecialRail} from '@/components/dealers/SpecialRail';
import {withAjesCount} from '@/lib/catalog/ajes-catalog';
import {Suspense} from 'react';
import {AjesRail,AjesRailPending,readAjesRailData} from '@/components/catalog/AjesRail';
import {WEBSITE_SCHEMA} from '@/lib/catalog/search-metadata';
import {DealerCitySync} from "@/components/dealers/DealerCitySync";
import {readShowcase} from "@/lib/dealers/showcase-store";
import {homeSpecialRail} from "@/lib/dealers/public-showcase";
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
  const canonical = "/";
  const openGraphUrl = city ? `https://avtocena.com/?city=${encodeURIComponent(city)}` : "https://avtocena.com";
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: openGraphUrl, type: "website" },
    verification: { google: "fKoSCYRhUlLSknjTU-ak0YWhATWdUCZLyVLCv5N0te8" },
  };
}

function HomeJapanRail({timing}:{timing:ReturnType<typeof createHomePhaseTiming>}){
 return <AjesRail prepared={timing.measure("japanRail",()=>readAjesRailData("japan"))}/>;
}
async function DealerGallery({dealer}:{dealer:ReturnType<typeof readShowcase>}){
 const value=await dealer;
 return <BuyerGallery images={value?.buyersEnabled?value.buyerPhotos.map(p=>p.url):[]}/>;
}
async function DealerSpecials({dealer,city,timing}:{dealer:ReturnType<typeof readShowcase>;city:string;timing:ReturnType<typeof createHomePhaseTiming>}){
 const value=await dealer;
 const rail=await timing.measure("dealerRail",()=>homeSpecialRail(city,value)).catch(error=>{console.error("home_specials_failed",error);return null;});
 if(!rail)return null;
 return <SpecialRail {...rail} desktopSplit/>;
}

export default async function HomePage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const timing=createHomePhaseTiming();
  const params = (await searchParams) || {};
  const cookieStore = await cookies();
  const fromQuery = cleanCity(first(params.city));
  const fromCookie = decodeCity(cookieStore.get("avtocena_city")?.value || "");
  const dealer=timing.measure("dealer",()=>readShowcase("dealer_topavto")).catch(error=>{console.error("home_dealer_failed",error);return null;});
  const snapshotPromise=timing.measure("snapshot",()=>readHomeCatalogSnapshot(10)).then(value=>{
    timing.setGeneration(value.generationId);return value;
  });
  let catalogFailed=false;
  const catalogPromise=snapshotPromise.then(value=>timing.measure("counts",()=>withAjesCount(value))).catch((error) => {
    console.error("home_initial_catalog_failed", error);
    catalogFailed=true;
    return { items: [], marketCounts: {}, total: 0, countIncomplete:true, marketCountInfo:{} };
  });
  const greenPromise=timing.measure("green",()=>readGreenCorner()).catch(() => null);
  let pricingIncomplete=false;
  const greenPricingPromise=greenPromise.then(green=>{
    const savedGreenItems=(green?.items || []).slice(0,10).map(publicGreenOffer);
    return timing.measure("greenPricing",()=>applyActiveBusinessPricingBatch(savedGreenItems)).catch(()=>{
      console.error("home_green_pricing_unavailable");pricingIncomplete=true;
      return savedGreenItems;
    });
  });
  // AJ counts preserve the snapshot's items, so pricing need not wait for them.
  const catalogPricingPromise=snapshotPromise.then(catalog=>
    timing.measure("catalogPricing",async()=>{
      const allowed=catalog.items.filter(item=>!(item as {preparedChinaSelection?:unknown}).preparedChinaSelection);
      if(allowed.length===catalog.items.length)return applyActiveBusinessPricingBatch(catalog.items);
      const repriced=await applyActiveBusinessPricingBatch(allowed);
      const byId=new Map(repriced.map(item=>[item.id,item]));
      return catalog.items.map(item=>(item as {preparedChinaSelection?:unknown}).preparedChinaSelection?item:byId.get(item.id)??item);
    }).catch((error) => {
      console.error("home_initial_pricing_failed", error);
      pricingIncomplete=true;
      // Preserve the last audited quote if settings storage is temporarily down.
      return catalog.items;
    }),
    // A failed read must not start counts or pricing on an invented snapshot.
    ()=>[],
  );
  const [catalog, green, greenItems, pricedSnapshotItems] = await Promise.all([
    catalogPromise, greenPromise, greenPricingPromise, catalogPricingPromise,
  ]);
  // Keep the existing empty-catalog fallback if counts unexpectedly reject.
  const pricedItems=catalogFailed?catalog.items:pricedSnapshotItems;
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(WEBSITE_SCHEMA)}}/>
    <DealerCitySync/>
    <div className={styles.scope}>
      <HomePageClient
        japanAuctions={<Suspense fallback={<AjesRailPending/>}><HomeJapanRail timing={timing}/></Suspense>}
        dealerGallerySlot={<Suspense fallback={<div className="min-h-[160px]" aria-busy="true"/>}><DealerGallery dealer={dealer}/></Suspense>}
        specialRailSlot={<Suspense fallback={null}><DealerSpecials dealer={dealer} city={fromQuery || fromCookie} timing={timing}/></Suspense>}
        initialGreen={{items:greenItems,total:green?.items.length || 0}}
        initialCity={fromQuery || fromCookie}
        initialOffers={pricedItems}
        initialMarketCounts={catalog.marketCounts}
        initialCount={catalog.total + (green?.items.length || 0)}
        initialCountIncomplete={catalog.countIncomplete || !green || pricingIncomplete}
        initialMarketCountInfo={catalog.marketCountInfo}
      />
    </div>
    <style dangerouslySetInnerHTML={{ __html: "@media (min-width:1024px){.ac-budget-help{display:none!important}}" }} />
  </>;
}
