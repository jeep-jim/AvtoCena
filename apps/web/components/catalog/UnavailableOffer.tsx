import { Suspense } from "react";
import { UnavailableOfferView } from "./UnavailableOfferView";
import { CatalogCard } from "./CatalogCard";
import { searchOffers } from "@/lib/catalog/storage";
import { applyActiveBusinessPricingBatch } from "@/lib/catalog/live-business-pricing";
import { isRenderableRelatedOffer } from "@/lib/catalog/related-offer-selection";
import { priceCandidatesUntil } from "@/lib/catalog/price-candidates";
import { PUBLIC_CATALOG_MARKETS } from "@/lib/catalog/runtime-config";
import type { UnavailableOffer as UnavailableOfferRecord } from "@/lib/catalog/offer-availability";

async function Alternatives({offer}:{offer?:UnavailableOfferRecord|null}) {
  const search = async (make?:string,market?:string) => {
    try { return (await searchOffers({make,market,pageSize:12,sort:"updatedAt"})).items.filter(row=>row.id!==offer?.id); }
    catch(error) { console.error("unavailable_offer_alternatives",error); return []; }
  };
  const price = async (rows:any[]) => {
    try { return await priceCandidatesUntil(rows,applyActiveBusinessPricingBatch,isRenderableRelatedOffer,accepted=>accepted.length>=8); }
    catch(error) { console.error("unavailable_offer_pricing",error); return []; }
  };
  let rows = offer?.make ? await price(await search(offer.make)) : [];
  const sameMake = rows.length>0;
  if(!sameMake){
    const groups=await Promise.all(PUBLIC_CATALOG_MARKETS.filter(market=>market!==offer?.market).map(market=>search(undefined,market)));
    // Interleave markets so a single large source cannot occupy the whole rail.
    const candidates=Array.from({length:12},(_,i)=>groups.flatMap(group=>group[i]?[group[i]]:[])).flat();
    rows=await price(candidates);
  }
  const unique=[...new Map(rows.map(row=>[row.id,row])).values()].slice(0,8);
  if(!unique.length)return null;
  return <section className="ac-unavailable-alternatives" aria-labelledby="offer-alternatives-title"><div className="ac-unavailable-section-heading"><h2 id="offer-alternatives-title">{sameMake?`Другие автомобили ${offer?.make}`:"Посмотрите автомобили на других рынках"}</h2></div><div className="ac-unavailable-grid">{unique.map(row=><CatalogCard key={row.id} offer={row} compact/>)}</div></section>;
}

export function UnavailableOffer({offer,calculationUnavailable=false}:{offer?:UnavailableOfferRecord|null;calculationUnavailable?:boolean}) {
 return <UnavailableOfferView offer={offer} calculationUnavailable={calculationUnavailable}><Suspense fallback={<div className="ac-unavailable-loading" role="status">Подбираем другие автомобили…</div>}><Alternatives offer={offer}/></Suspense></UnavailableOfferView>;
}
