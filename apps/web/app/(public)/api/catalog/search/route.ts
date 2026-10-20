import {readGreenCorner,readGreenCornerPage} from '@/lib/catalog/green-corner';
import {GET as greenSearch} from "@/app/api/catalog/green/route";
import {exactAjesCount} from '@/lib/catalog/ajes-count-display';
import {usesAjesMarket} from '@/lib/catalog/ajes-market-selection';
import {ajesErrorResponse} from '@/lib/catalog/ajes-error-response';
import {readAjesCatalogPage,readAjesCountSummary,withAjesCount} from '@/lib/catalog/ajes-catalog';
import { readCatalogMarketPage } from "@/lib/catalog/market-page";
import { PUBLIC_CATALOG_MARKET_SET } from "@/lib/catalog/runtime-config";
import type { CatalogMarket } from "@/lib/catalog/types";
import { parseEngineCc } from "@/lib/catalog/engine-input";
import { applyActiveBusinessPricingBatch } from "@/lib/catalog/live-business-pricing";
import { NextResponse } from "next/server";
import { loadPublicRateExtras } from "@/lib/catalog/public-rates";
import { countCatalogOffers, readCatalogFacets, searchOffers } from "@/lib/catalog/storage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function n(v: string | null) {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : undefined;
}

export async function GET(request: Request) {
  const started = performance.now();
  const u = new URL(request.url);
  const p = u.searchParams;
  if(p.get('stock')==='green'&&(!p.get('market')||p.get('market')==='japan'))return greenSearch(request);
  if(await usesAjesMarket(p.get('market'),p.get('source'))&&!(p.get('market')==='japan'&&p.get('stock')==='green')){
    try{
      const params=Object.fromEntries(p);
      const summary=p.get('countOnly')==='1'?await readAjesCountSummary(JSON.stringify(params)):null;
      const result=summary?{total:exactAjesCount(summary)??null,countSummary:summary,countIncomplete:exactAjesCount(summary)===undefined,items:[]}:await readAjesCatalogPage(params);
      return NextResponse.json({ok:true,...result},{headers:{'Cache-Control':'private, max-age=15, stale-while-revalidate=30'}});
    }catch(e){const failure=ajesErrorResponse(e);return NextResponse.json(failure.body,{status:failure.status,headers:{'Cache-Control':'no-store'}});}
  }
  const query: Parameters<typeof searchOffers>[0] = {
    city: p.get("city") || undefined,
    market: p.get("market") || undefined,
    make: p.get("make") || p.get("brand") || undefined,
    model: p.get("model") || undefined,
    hasPrice: p.get("hasPrice") || undefined,
    budgetFrom: n(p.get("budgetFrom")),
    budgetTo: n(p.get("budgetTo") || p.get("budget")),
    yearFrom: n(p.get("yearFrom")),
    yearTo: n(p.get("yearTo")),
    mileageFrom: n(p.get("mileageFrom")),
    mileageTo: n(p.get("mileageTo")),
    engineFrom: parseEngineCc(p.get("engineFrom")),
    engineTo: parseEngineCc(p.get("engineTo")),
    powerFrom: n(p.get("powerFrom")),
    powerTo: n(p.get("powerTo")),
    fuel: p.get("fuel") || undefined,
    transmission: p.get("transmission") || undefined,
    drive: p.get("drive") || undefined,
    bodyType: p.get("bodyType") || p.get("body") || undefined,
    auctionGrade: p.get("auctionGrade") || undefined,
    auctionDateFrom: p.get("auctionDateFrom") || undefined,
    auctionDateTo: p.get("auctionDateTo") || undefined,
    sort: p.get("sort") || undefined,
    page: n(p.get("page")),
    pageSize: n(p.get("pageSize")),
  };
  if (p.get("marketPage") === "1") {
    if (!PUBLIC_CATALOG_MARKET_SET.has(query.market as CatalogMarket) || !Number.isInteger(query.page || 1) || (query.page || 1) > 10000) return NextResponse.json({ok:false}, {status:400});
    const result = await readCatalogMarketPage(query);
    return NextResponse.json({ok:true,...result}, {headers:{"Cache-Control":"public, max-age=30, s-maxage=30", "Server-Timing":`catalog-page;dur=${(performance.now()-started).toFixed(1)}`}});
  }
  if (p.get("countOnly") === "1") {
    let result = await withAjesCount(await countCatalogOffers(query),query);
    if(!query.market){
      const green=await readGreenCorner().catch(()=>null);
      const greenTotal=green?(await readGreenCornerPage(green.items,{...Object.fromEntries(p),page:"1"})).total:0;
      result={...result,total:result.total+greenTotal,countIncomplete:result.countIncomplete||!green};
    }
    return NextResponse.json({ok: true, ...result, items: []}, {headers: {"Cache-Control": "public, max-age=30, s-maxage=30", "Server-Timing": `catalog-count;dur=${(performance.now()-started).toFixed(1)}`}});
  }
  const [result, facets, rateExtras] = await Promise.all([
    searchOffers(query),
    p.get("includeFacets") === "1" ? readCatalogFacets(query) : Promise.resolve(undefined),
    p.get("includeRates") === "1" ? loadPublicRateExtras() : Promise.resolve(undefined),
  ]);
  const extras: Record<string, unknown> = {};
  if (facets) extras.facets = facets;
  if (rateExtras) Object.assign(extras, rateExtras);
  const readMs = performance.now() - started;
  // Exclude the local China inventory only while the live supplier is selected.
  // AJES is paginated separately by market; do not invent a combined count.
  const crossMarket=!query.market;
  const liveChina=crossMarket&&await usesAjesMarket('china');
  const candidates=crossMarket?result.items.filter(offer=>offer.market!=='korea'&&(!liveChina||offer.market!=='china')):result.items;
  const items = await applyActiveBusinessPricingBatch(candidates);
  const pricingMs = performance.now() - started - readMs;
  return NextResponse.json({ ok: true, ...result, ...(crossMarket?{total:null,partial:true,countIncomplete:true}:{}), items, ...extras }, { headers: { "Cache-Control": "public, max-age=30, s-maxage=30", "Server-Timing": `catalog-read;dur=${readMs.toFixed(1)}, catalog-pricing;dur=${pricingMs.toFixed(1)}` } });
}
