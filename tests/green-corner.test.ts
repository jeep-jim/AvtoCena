import {catalogCoverThumbnail} from "../apps/web/lib/catalog/cover-image";
import test, {mock} from "node:test";
import fs from "node:fs";
import {createGreenCornerLogistics,greenCornerLogisticsRub} from "../apps/web/lib/catalog/green-corner-contract";
import {calculateOfferWithCustomerParametersDetailed} from "../apps/web/lib/catalog/customs-pricing";
import {validateCustomerParameters} from "../apps/web/lib/catalog/customer-parameters";
import {LocalJsonStorage} from "../apps/web/lib/data";
import {resetCatalogRateCache} from "../apps/web/lib/catalog/rates";
import assert from "node:assert/strict";
import {normalizeGreenCorner,greenCornerFobPrice} from "../apps/web/lib/catalog/green-corner-normalize";
import {isSellerPricedOffer,sellerPriceLabel} from "../apps/web/lib/catalog/seller-price-contract";
import {collectGreenCorner,assertGreenPublication} from "../scripts/lib/akebono-green-source.mjs";
const now="2026-09-22T06:00:00Z";
const rate:any={currency:"JPY",effectiveRate:.6,cbrRate:60,nominal:100,rateDate:"2026-09-22",rateSource:"cbr",sourcePrice:1,sourcePriceRub:.6};
const row={id:727977,company:"MERCEDES - BENZ",model:"GLA 180",year:"2015",yearForCustom:"2018",horsepower:122,mileageNum:"89",engineVolumeNum:"1600",priceInJapan:"920000",priceInJapanCurrency:"JPY",isSold:false,location:"japan",subgroup:"auto",media:["https://img.akebono.world/a.JPG","https://media.akebono.world/a.mp4"]};
test("Green stock retains actual year and source FOB, keeps logistics separate, excludes videos",()=>{
 const o=normalizeGreenCorner(row,rate,now);
 assert.equal(o.year,2015);assert.equal(o.mileageKm,89000);assert.equal(o.sourcePrice,920000);
 assert.equal(o.sellerPriceRub,552000);assert.equal(o.totalRub,null);assert.equal(o.images.length,1);
 assert.equal(o.offerType,"fixed");assert.equal(o.catalogKind,"listing");assert.ok(isSellerPricedOffer(o));
 assert.equal(sellerPriceLabel(o),"Цена FOB");
 assert.ok(!isSellerPricedOffer({...o,sellerPriceRub:642000}));

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

test("FOB uses active discounts but never expired discounts",()=>{
 assert.equal(greenCornerFobPrice({...row,discountPrice:880000},now),880000);
 assert.equal(greenCornerFobPrice({...row,discount:10},now),828000);
 assert.equal(greenCornerFobPrice({...row,discountPrice:880000,discountExpiresAt:"2026-09-01"},now),920000);
});

test("stock covers use the verified small rendition without changing gallery URLs",()=>{
 const url="https://img.akebono.world/f5475203-dc90-4efe-ba51-3a2007383fd8.JPG";
 assert.equal(catalogCoverThumbnail(url),"https://img.akebono.world/400x300/f5475203-dc90-4efe-ba51-3a2007383fd8.JPG");
 assert.equal(catalogCoverThumbnail(catalogCoverThumbnail(url)),catalogCoverThumbnail(url));
});


test("logistics anchor remains fixed in JPY while rubles follow the rate",()=>{
 const basis=createGreenCornerLogistics(rate);
 assert.equal(basis.amountJpy,75000);
 assert.equal(greenCornerLogisticsRub(basis,.6),45000);
 assert.equal(greenCornerLogisticsRub(basis,.66),49500);
 assert.equal(greenCornerLogisticsRub(basis,.54),40500);
 assert.throws(()=>greenCornerLogisticsRub(undefined,.6));
 assert.throws(()=>greenCornerLogisticsRub({...basis,amountJpy:90000},.6));
});

test("Green uses the full Japan breakdown with exactly one yen-linked logistics line",async()=>{
 const markets=JSON.parse(fs.readFileSync("data/markets/markets.json","utf8"));
 const today=new Date().toISOString();
 const previous=process.env.CATALOG_LIVE_RATE_DISABLED;process.env.CATALOG_LIVE_RATE_DISABLED="true";resetCatalogRateCache();
 const read=mock.method(LocalJsonStorage.prototype,"readJsonWithMeta",async(key:string)=>({found:true,value:key==="fees/exchange-rates.json"?{updatedAt:today,JPY:{cbrRate:66,nominal:100,rateDate:today,rateSource:"cbr"},EUR:{cbrRate:95,nominal:1,rateDate:today,rateSource:"cbr"},USD:{cbrRate:90,nominal:1,rateDate:today,rateSource:"cbr"}}:key==="markets/markets.json"?markets:{}}));
 try {
  const input={...normalizeGreenCorner(row,rate,now),greenCornerLogistics:createGreenCornerLogistics(rate)};
  const before=JSON.stringify(input);
  const params=validateCustomerParameters({year:2015,engineCc:1600,powerHp:122,fuel:"petrol"});
  const green=await calculateOfferWithCustomerParametersDetailed(input,params);
  const ordinary=await calculateOfferWithCustomerParametersDetailed({...input,id:"ordinary",sourceId:"ordinary"},params);
  assert.equal(green.ok,true);assert.equal(ordinary.ok,true);
  if(green.ok&&ordinary.ok){
   const lines=green.calculation.breakdown, other=ordinary.calculation.breakdown;
   assert.equal(lines.filter((l:any)=>l.id==="logistics").length,1);
   assert.equal(lines.find((l:any)=>l.id==="logistics")?.amountRub,49500);
   assert.equal(lines.find((l:any)=>l.id==="car")?.amountRub,607200);
   assert.deepEqual(lines.filter((l:any)=>l.id!=="logistics"),other.filter((l:any)=>l.id!=="logistics"));
   assert.equal(lines.reduce((sum:number,l:any)=>sum+l.amountRub,0),green.calculation.totalRub);
   assert.ok(lines.some((l:any)=>l.id==="laboratory"));
   assert.ok(lines.some((l:any)=>l.id==="topavto-commission"));
   assert.equal(green.calculation.paymentPlan.securityDepositRub,ordinary.calculation.paymentPlan.securityDepositRub);
  }
  assert.equal(JSON.stringify(input),before);
  const missing=await calculateOfferWithCustomerParametersDetailed({...input,greenCornerLogistics:undefined},params);
  assert.equal(missing.ok,false);
 }finally{read.mock.restore();resetCatalogRateCache();if(previous===undefined)delete process.env.CATALOG_LIVE_RATE_DISABLED;else process.env.CATALOG_LIVE_RATE_DISABLED=previous;}
});
