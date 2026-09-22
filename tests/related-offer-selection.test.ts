import {readFileSync} from "node:fs";
import test from 'node:test';
import assert from 'node:assert/strict';
import {selectRelatedOfferGroups} from '../apps/web/lib/catalog/related-offer-selection';
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
