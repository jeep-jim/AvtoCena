import test from "node:test";
import assert from "node:assert/strict";
import {normalizeGreenCorner} from "../apps/web/lib/catalog/green-corner-normalize";
import {isSellerPricedOffer,sellerPriceLabel} from "../apps/web/lib/catalog/seller-price-contract";
import {collectGreenCorner,assertGreenPublication} from "../scripts/lib/akebono-green-source.mjs";
const now="2026-09-22T06:00:00Z";
const rate:any={currency:"JPY",effectiveRate:.6,cbrRate:60,nominal:100,rateDate:"2026-09-22",rateSource:"cbr",sourcePrice:1,sourcePriceRub:.6};
const row={id:727977,company:"MERCEDES - BENZ",model:"GLA 180",year:"2015",yearForCustom:"2018",horsepower:122,mileageNum:"89",engineVolumeNum:"1600",priceInJapan:"920000",priceInJapanCurrency:"JPY",isSold:false,location:"japan",subgroup:"auto",media:["https://img.akebono.world/a.JPG","https://media.akebono.world/a.mp4"]};
test("Green stock retains actual year and source FOB, adds 45000 once, excludes videos",()=>{
 const o=normalizeGreenCorner(row,rate,now);
 assert.equal(o.year,2015);assert.equal(o.mileageKm,89000);assert.equal(o.sourcePrice,920000);
 assert.equal(o.sellerPriceRub,597000);assert.equal(o.totalRub,null);assert.equal(o.images.length,1);
 assert.equal(o.offerType,"fixed");assert.equal(o.catalogKind,"listing");assert.ok(isSellerPricedOffer(o));
 assert.equal(sellerPriceLabel(o),"FOB + 45 000 ₽");
 assert.ok(!isSellerPricedOffer({...o,sellerPriceRub:642000}));
 assert.ok(!isSellerPricedOffer({...o,sourceId:"other"}));
});
test("Green rejects sold stock and unbound or stale currency",()=>{
 assert.throws(()=>normalizeGreenCorner({...row,isSold:true},rate,now));
 assert.throws(()=>normalizeGreenCorner(row,{...rate,rateDate:"2026-08-01"},now));
 assert.throws(()=>normalizeGreenCorner(row,{...rate,currency:"USD"},now));
});
test("Complete public source pagination is required before publication",async()=>{
 let calls=0;
 const request=async()=>({ok:true,json:async()=>({data:{lotsPaginatedList:{totalCount:2,items:[{...row,id:++calls}]}}})});
 const result=await collectGreenCorner({request,pause:async()=>{},pageSize:1});
 assert.equal(result.items.length,2);
 await assert.rejects(()=>collectGreenCorner({request:async()=>({ok:true,json:async()=>({data:{lotsPaginatedList:{totalCount:2,items:[row]}}})}),pause:async()=>{},pageSize:1}),/duplicate/);
 await assert.rejects(()=>collectGreenCorner({request:async()=>({ok:true,json:async()=>({data:{lotsPaginatedList:{totalCount:2,items:[]}}})}),pause:async()=>{}}),/incomplete/);
});
test("Green denies collapse and empty replacement but permits ordinary stock turnover",()=>{
 assert.doesNotThrow(()=>assertGreenPublication(448,430,430));
 assert.throws(()=>assertGreenPublication(448,100,100),/collapse/);
 assert.throws(()=>assertGreenPublication(448,0,0));
});
