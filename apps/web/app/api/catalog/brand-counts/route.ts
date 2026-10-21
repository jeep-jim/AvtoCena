import {withCatalogEditorial,applyCatalogEditorial,editorialHidden} from '@/lib/catalog/editorial';
import {applyEncyclopediaDisplayIdentityBatch} from '@/lib/catalog/display-identity';
import {usesAjesMarket} from '@/lib/catalog/ajes-market-selection';
import {readAjesMakes} from '@/lib/catalog/ajes-catalog';
import { cookies } from "next/headers";
import { currentGreenCornerPrices, readGreenCorner } from "@/lib/catalog/green-corner";
import { filterGreenCorner, greenCornerNeedsFullPricing } from "@/lib/catalog/green-corner-search";
import { NextResponse } from "next/server";
import { readCatalogBrandCounts } from "@/lib/catalog/storage";
import type { CatalogSearchParams } from "@/lib/catalog/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function text(url: URL, key: string) {
  return String(url.searchParams.get(key) || "").trim() || undefined;
}

function positiveNumber(url: URL, key: string) {
  const value = Number(url.searchParams.get(key) || 0);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if(!url.searchParams.has("city")){const city=(await cookies()).get("avtocena_city")?.value;if(city)url.searchParams.set("city",city);}
  if(url.searchParams.get("market")==="japan" && url.searchParams.get("stock")==="green") {
    const snapshot=await readGreenCorner();
    const params={...Object.fromEntries(url.searchParams),make:undefined,model:undefined};
    const rows=await withCatalogEditorial(async()=>{
      const visible=await applyEncyclopediaDisplayIdentityBatch(snapshot.items.filter(item=>!editorialHidden(item)).map(item=>applyCatalogEditorial(item)));
      const candidates=filterGreenCorner(visible,{...params,budgetFrom:undefined,budgetTo:undefined,budget:undefined,sort:undefined});
      return filterGreenCorner(greenCornerNeedsFullPricing(params)?await currentGreenCornerPrices(candidates):candidates,params);
    });
    const counts:Record<string,number>={},models=new Map<string,Set<string>>();
    for(const row of rows){counts[row.make]=(counts[row.make]||0)+1;const set=models.get(row.make)||new Set<string>();set.add(row.model);models.set(row.make,set);}
    return NextResponse.json({generationId:snapshot.updatedAt,counts,modelCounts:Object.fromEntries([...models].map(([make,set])=>[make,set.size]))});
  }
  if(await usesAjesMarket(url.searchParams.get('market'),url.searchParams.get('source'))){
    try{
      const params={...Object.fromEntries(url.searchParams),make:undefined,model:undefined};
      const result=await readAjesMakes(JSON.stringify(params)),counts:Record<string,number>={},modelCounts:Record<string,number>={};
      for(const row of result.makes)counts[row.make]=row.total;
      return NextResponse.json({generationId:result.observedAt,counts,modelCounts},{headers:{'Cache-Control':'private, max-age=30, stale-while-revalidate=60'}});
    }catch{return NextResponse.json({error:'japan_counts_unavailable'},{status:503});}
  }
  const params: CatalogSearchParams = {
    market: text(url, "market"), city: text(url,"city"),
    hasPrice: text(url, "hasPrice"),
    budgetFrom: positiveNumber(url, "budgetFrom"),
    budgetTo: positiveNumber(url, "budgetTo") || positiveNumber(url, "budget"),
    yearFrom: positiveNumber(url, "yearFrom"),
    yearTo: positiveNumber(url, "yearTo"),
    color:url.searchParams.get("color")||undefined, mileageFrom: positiveNumber(url, "mileageFrom"),
    mileageTo: positiveNumber(url, "mileageTo"),
    engineFrom: positiveNumber(url, "engineFrom"),
    engineTo: positiveNumber(url, "engineTo"),
    powerFrom: positiveNumber(url, "powerFrom"),
    powerTo: positiveNumber(url, "powerTo"),
    fuel: text(url, "fuel"),
    transmission: text(url, "transmission"),
    drive: text(url, "drive"),
    bodyType: text(url, "bodyType"),
    auctionGrade: text(url, "auctionGrade"),
    auctionDateFrom: text(url, "auctionDateFrom"),
    auctionDateTo: text(url, "auctionDateTo"),
  };
  const summary = await readCatalogBrandCounts(params);
  return NextResponse.json(summary, { headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=30" } });
}
