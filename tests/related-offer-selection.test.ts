import {readFileSync} from "node:fs";
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeGreenCorner} from '../apps/web/lib/catalog/green-corner-normalize';
import {selectRelatedOfferGroups,isRenderableRelatedOffer} from '../apps/web/lib/catalog/related-offer-selection';
const row=(id:string,market='japan',model='Vezel')=>({id,market,make:'Honda',model,totalRub:1000000});
const stock=(id:string)=>({...row(id),sourceId:'akebono_green_japan_open',offerType:'fixed'});
const select=(options:any)=>selectRelatedOfferGroups({current:row('current'),modelRows:[],marketRows:[],crossResults:[],greenModels:[],greenRows:[],price:async (rows:any[])=>rows,renderable:(r:any)=>r.totalRub>0,...options});
test('stock model precedes same-market models, cross-market models and market overview without duplicate IDs',async()=>{
 const current=stock('green-1'),green=stock('green-2'),auction=row('auction'),cross=row('cross','china'),other=row('other','japan','Fit');
 const groups=await select({current,greenModels:[current,green],modelRows:[current,auction],crossResults:[{market:'china',items:[cross]}],marketRows:[current,auction,other],greenRows:[current,green]});
 assert.deepEqual(groups.stockModels.map(r=>r.id),['green-2']);assert.deepEqual(groups.sameModel.map(r=>r.id),['auction']);assert.deepEqual(groups.crossMarketGroups[0].items.map(r=>r.id),['cross']);assert.deepEqual(groups.marketRows.map(r=>r.id),['other']);
});
test('every market keeps matching domestic models first and Japan stock belongs to Japan cross-market group',async()=>{
 for(const market of ['japan','china','korea','uae','europe','georgia']){
  const current=row('current',market),same=row('same',market),other=row('other',market,'Fit'),green=stock('green-2');
  const groups=await select({current,modelRows:[current,same],marketRows:[same,other],greenModels:[green],greenRows:[green],crossResults:market==='japan'?[]:[{market:'japan',items:[row('auction')]}]});
  assert.equal(groups.stockModels.length,0);assert.equal(groups.sameModel[0].id,'same');assert.equal(groups.marketRows[0].id,'other');
  assert.ok((market==='japan'?groups.sameModel:groups.crossMarketGroups[0].items).some(r=>r.id==='green-2'));
 }
});
test('unrenderable candidates are skipped and each recommendation group is bounded',async()=>{
 const calls:number[]=[];const candidates=Array.from({length:30},(_,i)=>({...row('model-'+i),totalRub:i<4?0:1}));
 const groups=await select({modelRows:candidates,price:async(rows:any[])=>{calls.push(rows.length);return rows;}});
 assert.equal(groups.sameModel.length,4);assert.deepEqual(calls,[4,4]);assert.equal(groups.sameModel[0].id,'model-4');
});

test('detail recommendations retain trusted source identity after publicOffer sanitization',()=>{
 const page=readFileSync('apps/web/app/(public)/cars/offer/[id]/page.tsx','utf8');
 assert.match(page,/<SimilarOffers current=\{\{\.\.\.raw,sourceId:offer.sourceId,offerType:offer.offerType\}\} \/>/);
});

test('published stock DTOs without private provenance remain eligible in recommendations',async()=>{
 const source={cifFreightJpy:74000,paymentQuote:{sell:56.7,nominal:100,fetchedAt:"2026-09-22"},id:713390,isSold:false,location:'japan',subgroup:'auto',priceInJapanCurrency:'JPY',priceInJapan:1000000,year:2026,horsepower:118,company:'HONDA',model:'VEZEL',media:['https://img.akebono.world/cars/713390.jpg']};
 const full=normalizeGreenCorner(source,{currency:'JPY',rateSource:'cbr',effectiveRate:0.6,rateDate:'2026-09-22'} as any,'2026-09-22');
 const {operational,vin,frameNumber,...published}=full;
 assert.equal(isRenderableRelatedOffer(published),true);
 assert.equal(isRenderableRelatedOffer({...published,images:[]}),false);
 assert.equal(isRenderableRelatedOffer({...published,sellerPriceRub:0}),false);
 assert.equal(isRenderableRelatedOffer({...published,sourceId:'untrusted'}),false);
 const groups=await select({current:{...full,id:'green-713392'},greenModels:[published],renderable:isRenderableRelatedOffer});
 assert.deepEqual(groups.stockModels.map(row=>row.id),['green-713390']);
});
