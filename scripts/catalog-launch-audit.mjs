import fs from 'node:fs/promises';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {getOffer, getUnavailableOffer} from '../apps/web/lib/catalog/storage.ts';
const storage=getJsonStorage();
const manifest=await storage.readJson('catalog/manifest.json',null);
const previous=await storage.readJson('catalog/previous-manifest.json',null);
const report={checkedAt:new Date().toISOString(),generationId:manifest?.generationId,markets:{},offers:{}};
for(const market of ['japan','china','korea','uae','europe','georgia','green']){
 const journal=await storage.readJson(`catalog/operations/markets/${market}.json`,null);
 report.markets[market]={manifest:manifest?.markets?.[market],journal};
}
for(const id of ['cbd5d3c2822eab380dead32b']){
 const offer=await getOffer(id),unavailable=await getUnavailableOffer(id);
 const generations=[];
 for(const m of [manifest,previous]){
  if(!m?.generationId)continue;
  const index=await storage.readJson(`catalog/generations/${m.generationId}/indexes/offers-by-id.json`,null);
  generations.push({generationId:m.generationId,location:index?.byId?.[id]||null});
 }
 report.offers[id]={offer:offer?{id:offer.id,make:offer.make,model:offer.model,market:offer.market,updatedAt:offer.updatedAt}:null,unavailable,generations};
}
await fs.writeFile('catalog-launch-audit.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
