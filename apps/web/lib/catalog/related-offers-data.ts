import 'server-only';
import {readAjesPublic} from './ajes-public';
import {readAjesCountSummary} from './ajes-catalog';
import {exactAjesCount} from './ajes-count-display';
import {readRelatedModelFamily} from './related-model-family';
import {selectRelatedOfferGroups,isRenderableRelatedOffer} from './related-offer-selection';
import {readGreenCorner,publicGreenOffer} from './green-corner';
import {filterGreenCorner} from './green-corner-search';
import {isGreenCornerOffer} from './green-corner-contract';
import {PUBLIC_CATALOG_MARKETS,CATALOG_MARKET_LABELS} from './runtime-config';
import {presentCatalogOffer} from './presentation';
import {applyActiveBusinessPricingBatch} from './live-business-pricing';
import {publicOffer,searchOffers} from './storage';
import {readCatalogEditorial,editorialHidden,applyCatalogEditorial} from './editorial';
import {runRelatedOfferOperation} from './related-offers-scheduler';
import type {RelatedOffersPayload} from './related-offer-types';

type SearchResult={items:any[];total:number|null};
const countValue=(value:unknown):number|null=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;

/** Call only after resolving the authoritative visible offer and dealer context.
 * This module is never invoked by an ordinary offer's initial server render.
 */
export async function readRelatedOffers(current:any,options:{markets?:readonly string[]}={}):Promise<RelatedOffersPayload> {
  const allowed=PUBLIC_CATALOG_MARKETS.filter(market=>!options.markets||options.markets.includes(market));
  const market=String(current.market||'');
  if(!allowed.some(value=>value===market))throw new Error('related_market_unavailable');
  let partial=false;
  const attempt=async<T>(kind:string,load:()=>Promise<T>):Promise<T|null>=>{
    try{return await runRelatedOfferOperation(load);}
    catch{partial=true;console.warn('offer_related_unavailable',kind);return null;}
  };
  const make=String(current.make||'').trim();
  const familyModel=await attempt('model-family',()=>readRelatedModelFamily(make,String(current.model||'').trim()))??String(current.model||'').trim();
  const greenCurrent=isGreenCornerOffer(current);
  const liveStock=/^ajes-(?:korea|china)-/.test(String(current.id));
  const presented=presentCatalogOffer(current);
  const modelTitle=[presented.makeLabel,familyModel||presented.modelLabel].filter(Boolean).join(' ');
  const safeSearch=async(params:Parameters<typeof searchOffers>[0]):Promise<SearchResult>=>{
    // A dealer's hidden market must not generate provider, search or price work.
    if(!allowed.some(value=>value===params.market))return {items:[],total:null};
    const result:any=await attempt('search-'+params.market,()=>params.market==='japan'||params.market==='korea'||(liveStock&&params.market===market)
      ?readAjesPublic({table:params.market==='korea'?'korea':params.market==='china'?'china':'stats',make:params.make,
        model:params.model?(/^ajes-(?:stats|korea|china)-/.test(String(current.id))?String(current.model):params.model):undefined,pageSize:24})
      :searchOffers(params));
    if(!result)return {items:[],total:null};
    if(result.stale||result.partial||result.interrupted||result.scanLimited)partial=true;
    return {items:result.items.filter((row:any)=>row?.market===params.market),
      total:result.stale||result.partial||result.interrupted||result.scanLimited?null:countValue(result.total)};
  };
  const otherMarkets=allowed.filter(value=>value!==market);
  const needsGreen=allowed.includes('japan')&&Boolean(familyModel&&make||market==='japan');
  const [modelResult,marketResult,crossResults,green,countSummary]=await Promise.all([
    familyModel&&make?safeSearch({market:current.market,make,model:familyModel,pageSize:48,sort:'updatedAt'}):Promise.resolve({items:[],total:null}),
    safeSearch({market:current.market,pageSize:48,sort:'updatedAt'}),
    Promise.all(otherMarkets.map(async target=>({market:target,...(familyModel&&make?await safeSearch({market:target,make,model:familyModel,pageSize:24,sort:'updatedAt'}):{items:[],total:null})}))),
    needsGreen?attempt('green',async()=>{
      const [snapshot,editorial]=await Promise.all([readGreenCorner(),readCatalogEditorial()]);
      if(!Number.isFinite(Date.parse(snapshot.updatedAt)))throw new Error('green_snapshot_unavailable');
      return {...snapshot,items:snapshot.items.filter(row=>!editorialHidden(row,editorial)).map(row=>applyCatalogEditorial(row,editorial))};
    }):Promise.resolve(null),
    market==='japan'||liveStock?attempt('count',()=>readAjesCountSummary(JSON.stringify({market}))):Promise.resolve(null),
  ]);
  const greenModels=green&&familyModel&&make?filterGreenCorner(green.items,{make,model:familyModel}).map(publicGreenOffer):[];
  const groups=await selectRelatedOfferGroups({current,modelRows:modelResult.items,marketRows:marketResult.items,crossResults,
    greenModels,greenRows:(green?.items||[]).map(publicGreenOffer),
    price:async rows=>{
      const priced=await attempt('pricing',()=>applyActiveBusinessPricingBatch(rows));
      if(!priced)throw new Error('related_pricing_unavailable');
      return priced;
    },renderable:row=>allowed.includes(row?.market)&&isRenderableRelatedOffer(row),
  });
  const exactCount=exactAjesCount(countSummary)??null;
  let marketTotal=marketResult.total;
  if(market==='japan'||liveStock){
    if(exactCount===null)partial=true;
    marketTotal=market==='japan'?(exactCount===null||!green?null:exactCount+green.items.length):exactCount;
  }
  // Use the existing public DTO only after price and provenance checks. The
  // caller never receives operational fields, private source data or raw photos.
  return {current:{market,greenCurrent,liveStock},make,familyModel,modelTitle,
    marketLabel:String(presented.marketLabel||CATALOG_MARKET_LABELS[current.market as keyof typeof CATALOG_MARKET_LABELS]||'рынка'),
    marketTotal,stockModels:groups.stockModels.map(publicOffer),sameModel:groups.sameModel.map(publicOffer),
    crossMarketGroups:groups.crossMarketGroups.map(group=>({market:group.market,items:group.items.map(publicOffer)})),
    marketRows:groups.marketRows.map(publicOffer),partial};
}
