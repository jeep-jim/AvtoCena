import 'server-only';
import {getOfferDetailRecord} from '@/lib/catalog/offer-page-data';
import {getUnavailableOffer,publicOffer,searchOffers} from '@/lib/catalog/storage';
import {readAjesPublic} from '@/lib/catalog/ajes-public';
import {readAjesCount} from '@/lib/catalog/ajes-catalog';
import {readRelatedModelFamily} from '@/lib/catalog/related-model-family';
import {selectRelatedOfferGroups,isRenderableRelatedOffer} from '@/lib/catalog/related-offer-selection';
import {readGreenCorner,publicGreenOffer} from '@/lib/catalog/green-corner';
import {filterGreenCorner} from '@/lib/catalog/green-corner-search';
import {isGreenCornerOffer} from '@/lib/catalog/green-corner-contract';
import {applyActiveBusinessPricingBatch} from '@/lib/catalog/live-business-pricing';
import {priceCandidatesUntil} from '@/lib/catalog/price-candidates';
import {presentCatalogOffer} from '@/lib/catalog/presentation';
import {PUBLIC_CATALOG_MARKETS} from '@/lib/catalog/runtime-config';
import type {RelatedRecommendations,AlternativeRecommendations} from '@/components/catalog/recommendation-types';

// Preserve the existing search, admission, pricing and grouping rules. Only
// request their UI when visible; limit each request to two concurrent searches.
async function bounded<T>(jobs:(()=>Promise<T>)[]):Promise<T[]> {
  const results:T[]=[];let next=0;
  await Promise.all(Array.from({length:Math.min(2,jobs.length)},async()=>{
    while(next<jobs.length){const index=next++;results[index]=await jobs[index]();}
  }));
  return results;
}

export async function loadRelatedRecommendations({id,markets}:{id:string;markets?:string[]}):Promise<RelatedRecommendations> {
  // Only a trusted, visible current record supplies identity/provenance. The
  // browser never submits prices, source IDs, SQL, visitor IP or vehicle facts.
  const current=await getOfferDetailRecord(id);
  if(!current)throw Error('recommendation_offer_unavailable');
  const make=String(current.make||'').trim();
  const familyModel=await readRelatedModelFamily(make,String(current.model||'').trim());
  const presented=presentCatalogOffer(current);
  let partial=false;
  const otherMarkets=PUBLIC_CATALOG_MARKETS.filter(market=>market!==current.market&&(!markets||markets.includes(market)));
  const empty=()=>({items:[],total:0 as number|null});
  const safeSearch=async(params:Parameters<typeof searchOffers>[0])=>{
    try {
      return params.market==='japan'||params.market==='korea'||(/^ajes-(?:korea|china)-/.test(current.id)&&params.market===current.market)
        ? await readAjesPublic({table:params.market==='korea'?'korea':params.market==='china'?'china':'stats',make:params.make,model:params.model?(/^ajes-(?:stats|korea|china)-/.test(current.id)?String(current.model):params.model):undefined,pageSize:24}).then(result=>({items:result.items,total:null}))
        : await searchOffers(params,48,'related');
    } catch {partial=true;return {items:[],total:null};}
  };
  const results=await bounded([
    ()=>familyModel&&make?safeSearch({market:current.market,make,model:familyModel,pageSize:48,sort:'updatedAt'}):Promise.resolve(empty()),
    ()=>safeSearch({market:current.market,pageSize:48,sort:'updatedAt'}),
    ...otherMarkets.map(market=>()=>familyModel&&make?safeSearch({market,make,model:familyModel,pageSize:24,sort:'updatedAt'}):Promise.resolve(empty())),
  ]);
  const [modelResult,marketResult]=results;
  const crossResults=otherMarkets.map((market,index)=>({market,...results[index+2]}));
  const green=familyModel&&make&&(!markets||markets.includes('japan')||current.market==='japan')
    ? await readGreenCorner().catch(()=>{partial=true;return null;}):null;
  const greenModels=green?filterGreenCorner(green.items,{make,model:familyModel}).map(publicGreenOffer):[];
  const groups=await selectRelatedOfferGroups({
    current,modelRows:modelResult.items,marketRows:marketResult.items,crossResults,
    greenModels,greenRows:(green?.items||[]).map(publicGreenOffer),
    price:applyActiveBusinessPricingBatch,renderable:isRenderableRelatedOffer,
  });
  const liveStock=/^ajes-(?:korea|china)-/.test(current.id);
  const japanTotal=current.market==='japan'||liveStock?await readAjesCount(JSON.stringify({market:current.market})).catch(()=>{partial=true;return null;}):null;
  const marketTotal=liveStock?japanTotal:current.market==='japan'?(japanTotal===null?null:japanTotal+(green?.items.length||0))
    :marketResult.total===null?null:Math.max(0,Number(marketResult.total||0));
  return {kind:'related',current:{id:current.id,market:current.market},make,familyModel,
    greenCurrent:isGreenCornerOffer(current),modelTitle:[presented.makeLabel,familyModel||presented.modelLabel].filter(Boolean).join(' '),
    marketLabel:String(presented.marketLabel||current.market||'рынка'),marketTotal,
    stockModels:groups.stockModels.map(publicOffer),sameModel:groups.sameModel.map(publicOffer),
    crossMarketGroups:groups.crossMarketGroups.map(group=>({market:group.market,items:group.items.map(publicOffer)})),
    marketRows:groups.marketRows.map(publicOffer),partial};
}

export async function loadAlternativeRecommendations({id,markets}:{id:string;markets?:string[]}):Promise<AlternativeRecommendations> {
  const offer=id?await getUnavailableOffer(id)||await getOfferDetailRecord(id):null;
  let partial=false;
  const search=async(make?:string,market?:string)=>{
    try{return (await searchOffers({make,market,pageSize:12,sort:'updatedAt'})).items.filter(row=>row.id!==offer?.id&&(!markets||markets.includes(row.market)));}
    catch{partial=true;return [];}
  };
  const price=async(rows:any[])=>{
    try{return await priceCandidatesUntil(rows,applyActiveBusinessPricingBatch,isRenderableRelatedOffer,accepted=>accepted.length>=8);}
    catch{partial=true;return [];}
  };
  let rows=offer?.make?await price(await search(offer.make)):[];
  const sameMake=rows.length>0;
  if(!sameMake){
    const groups=await bounded(PUBLIC_CATALOG_MARKETS.filter(market=>market!==offer?.market&&(!markets||markets.includes(market))).map(market=>()=>search(undefined,market)));
    const candidates=Array.from({length:12},(_,i)=>groups.flatMap(group=>group[i]?[group[i]]:[])).flat();
    rows=await price(candidates);
  }
  const unique=[...new Map(rows.map(row=>[row.id,row])).values()].slice(0,8);
  return {kind:'alternatives',title:sameMake?`Другие автомобили ${offer?.make}`:'Посмотрите автомобили на других рынках',items:unique.map(publicOffer),partial};
}
