import test from 'node:test';
import assert from 'node:assert/strict';
import {Q,hash,galleryEvidence,safeTypedOffer,makeReadyFiles} from './ready.mjs';
const date='2026-11-21T03:45:04.942Z';
const paid='https://www.dubicars.com/images/real-1.jpg';
const src=i=>'https://www.dubicars.com/valid-'+i+'.html';
const ports={deliveredRub:x=>x.totalRub||0,isSeller:x=>x.catalogPricingMode==='seller'&&x.sellerPriceRub>0,
 isRequest:x=>x.sourcePrice===null,siteEligible:()=>true,nativeProjection:o=>({id:o.id,market:o.market,sourceGroup:o.sourceId,sellerPriceRub:o.sellerPriceRub,
  cardImageUrl:o.images[0]?.url,totalRub:o.totalRub})};
test('sanitized typed actor matches sealed native gallery without copying raw seller media',()=>{
 const row={id:'a'.repeat(24),market:'uae',sourceId:'dubicars_uae_exact',sourceOfferId:'1',status:'active',totalRub:null,sellerPriceRub:22380,
  sourcePrice:1000,sourceCurrency:'AED',catalogPricingMode:'seller',calculationStatus:'ready',images:[{url:paid},{url:paid+'?secret=bad'}],vin:'never',
  operational:{sourceUrl:src(1),lastSeenAt:date,photoIdentityVerified:true,raw:{seller:{privatePhone:'never'}}},
  calculationSnapshot:{currencyRate:{rateSource:'cbr',rateDate:'2026-11-21',effectiveRate:22.3801,sourcePriceRub:22380}}};
 const {links,...gallery}=galleryEvidence(row);
 const d={id:row.id,observedAt:date,sourcePrice:1000,priceKind:'seller',privateSellerRub:22380,galleryEvidence:gallery};
 const o=safeTypedOffer(row,d,ports);
 assert.deepEqual(o.images.map(i=>i.url),[paid]);assert.equal(o.vin,undefined);assert.equal(o.operational.raw,undefined);
 assert.throws(()=>safeTypedOffer({...row,sellerPriceRub:22381},d,ports),/native_seller_changed/);
 assert.throws(()=>safeTypedOffer({...row,images:[{url:'https://www.dubicars.com/images/foreign.jpg'}]},d,ports),/ordered_gallery_changed/);
 assert.throws(()=>safeTypedOffer({...row,totalRub:1,catalogPricingMode:undefined},d,ports),/native_card_scope/);
});
test('exact full-sized seller/request fixture builds reader ABI, bounded lists/detail shards and no delivered',async()=>{
 const rows=new Map(),chosen=new Map(), until=Date.now()+600000;
 for(let i=0;i<Q.seller+Q.onRequest;i++){
  const id=hash(i).slice(0,24),s=i<Q.seller, priceKind=s?'seller':'onRequest';
  const kept=(s&&i<Q.retainedSeller)||(!s&&i<Q.seller+Q.retainedRequest);
  rows.set(id,{id,market:'uae',sourceId:'dubicars_uae_exact',images:[],totalRub:null,sellerPriceRub:s?900000:undefined});
  chosen.set(id,{id,priceKind,privateSellerRub:s?900000:null,observedAt:date,state:kept?'legacy_retention_not_fresh':'verified_source_state',galleryEvidence:{digest:'a'.repeat(64)}});
 }
 const input={rows,qualification:{chosen},ports,runId:'44868777867',generationId:'gen_1795229934999_uae44868777867',legalValidUntil:until};
 const p=await makeReadyFiles(input);
 assert.deepEqual(p.ready.admitted,{seller:22050,onRequest:4474,retainedDelivered:0});
 assert.equal(p.ready.kind,'uae-private-runtime-ready-v1');assert.equal(p.blocks,104);assert.equal(p.detailShards,256);
 assert.equal(p.paths.get('READY.json').sha256,p.readySha256);
 await assert.rejects(makeReadyFiles({...input,maxTotal:4000}),/staged_object_size/);
});
