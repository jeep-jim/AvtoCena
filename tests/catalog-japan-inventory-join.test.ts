import test,{mock} from "node:test";
import fs from "node:fs";
import {LocalJsonStorage} from "../apps/web/lib/data";
import {resetCatalogRateCache} from "../apps/web/lib/catalog/rates";
import {calculateOfferWithVerifiedSpecifications} from "../apps/web/lib/catalog/customs-pricing";
import assert from "node:assert/strict";
import { JpaucPastAdapter, parseJpaucListingRows } from "../apps/web/lib/catalog/jpauc-past-source";
import { CarvectorJapanExactAdapter } from "../apps/web/lib/catalog/carvector-current-source";
import { joinJapanInventory } from "../apps/web/lib/catalog/japan-inventory-join";
import { japanAuctionSoldIdentityVerified,japanAuctionSoldPriceVerified } from "../apps/web/lib/catalog/public-priority";

function pair() {
 const html='<table><tr data-id="344621799" data-r="1" data-r-total="43"><td></td><td></td><td>2026-08-26</td><td>USS Tokyo | 89</td><td>BMW<br>330i</td><td>Year: 2022 FX</td><td>1,998 cc | 3BA-5R20</td><td>AT | 12,345 KM</td><td>Color: WHITE Auc.Grade: 4</td><td>Status: Sold | Start: ¥ 200,000</td><td><img data-original="https://p3.aleado.com/pic/?system=auto&date=2026-08-26&auct=37&bid=89&number=0"></td></tr></table>';
 const jp=new JpaucPastAdapter().normalizeOffer(parseJpaucListingRows(html)[0])!;
 const id="00000000-0000-4000-8000-000000000001";
 const cv=new CarvectorJapanExactAdapter().normalizeOffer({__typename:"OfferAuction",kind:"AUCTION_STATS",id,urlPage:{fullUrl:`/stat/bmw/330i/${id}`},make:{title:"BMW"},model:{title:"330i"},chassis:{title:"5R20"},year:2022,power:258,engineVolume:1998,mileage:12345,fuel:{title:"Gasoline"},finishPrice:{JPY:1850000},auction:{title:"USS Tokyo"},auctionAt:"2026-08-25T15:30:00Z",lot:"89"})!;
 assert.ok(jp);assert.ok(cv);return [jp,cv];
}
test("Japan joins an exact sold lot with Japan-local date and preserves its own pictures and source facts",()=>{
 const input=pair(),before=JSON.stringify(input),result=joinJapanInventory(input),offer=result.offers[0];
 assert.equal(result.report.joined,1);assert.equal(offer.sourcePrice,1850000);assert.equal(offer.powerHp,258);
 assert.equal(japanAuctionSoldIdentityVerified(offer),true);assert.equal(japanAuctionSoldPriceVerified(offer),true);
 assert.equal(offer.images.length,3);assert.ok(offer.images.every(img=>img.url.includes('aleado.com')));
 assert.equal(JSON.stringify(input),before);assert.equal(offer.totalRub,null);
});
test("different venue, chassis, engine, mileage or ambiguous evidence cannot donate a sold price",()=>{
 for(const change of [{auctionName:"USS Nagoya"},{generation:"5R21"},{engineCc:1997},{mileageKm:99999},{lotNumber:"90"}]){
  const [jp,cv]=pair();const result=joinJapanInventory([jp,{...cv,...change}]);assert.equal(result.report.joined,0);assert.equal(result.offers[0].sourcePrice,200000);
 }
 const [jp,cv]=pair();assert.equal(joinJapanInventory([jp,cv,{...cv,id:"other",sourceOfferId:"other",sourcePrice:1950000}]).report.ambiguous,1);
});
test("a mismatched image lot or unsold result cannot be admitted by a matching price record",()=>{
 for(const field of ['image','status']){
  const [jp,cv]=pair();const raw=jp.operational.raw as any;
  if(field==='image')raw.listingImage=raw.listingImage.replace('bid=89','bid=90');else raw.sourceStatus='Unsold';
  assert.equal(joinJapanInventory([jp,cv]).report.joined,0);
 }
});

test("verified Japan auction calculates automatically only in the explicitly enabled inventory path",async()=>{
 const offer=joinJapanInventory(pair()).offers[0];
 await assert.rejects(calculateOfferWithVerifiedSpecifications(offer),/verified_specifications_required/);
 const today=new Date().toISOString(),markets=JSON.parse(fs.readFileSync("data/markets/markets.json","utf8"));
 const previous=process.env.CATALOG_LIVE_RATE_DISABLED;process.env.CATALOG_LIVE_RATE_DISABLED="true";resetCatalogRateCache();
 const read=mock.method(LocalJsonStorage.prototype,"readJsonWithMeta",async(key:string)=>({found:true,value:key==="fees/exchange-rates.json"?{updatedAt:today,EUR:{cbrRate:95,nominal:1,rateDate:today,rateSource:"cbr"},JPY:{cbrRate:60,nominal:100,rateDate:today,rateSource:"cbr"},USD:{cbrRate:90,nominal:1,rateDate:today,rateSource:"cbr"}}:key==="markets/markets.json"?markets:{}}));
 try {
  const before=JSON.stringify(offer),result=await calculateOfferWithVerifiedSpecifications(offer,true);
  assert.ok(Number(result.totalRub)>1_110_000,JSON.stringify(result.calculationSnapshot));
  assert.equal(result.calculationSnapshot?.customs?.status,"ready");assert.equal(JSON.stringify(offer),before);
 } finally {read.mock.restore();resetCatalogRateCache();if(previous===undefined)delete process.env.CATALOG_LIVE_RATE_DISABLED;else process.env.CATALOG_LIVE_RATE_DISABLED=previous;}
});

test('Drom enriches only an exact lot and keeps its own sold price and provenance',()=>{
 const [jp]=pair();
 const drom:any={...structuredClone(jp),id:'drom-lot',sourceId:'drom_japan_stat',sourceOfferId:'8493500',sourcePrice:1800000,images:[{url:'https://s.auto.drom.ru/own-lot.jpg'}],operational:{...jp.operational,sourceUrl:'https://www.drom.ru/world/japan/bmw/330i/8493500/',raw:{nominalEngineCc:1998}}};
 const result=joinJapanInventory([drom,jp]);
 assert.equal(result.report.joined,1);assert.equal(result.offers[0].sourcePrice,1800000);assert.equal(result.offers[0].images.length,4);assert.equal(result.offers[0].operational.sourceUrl,drom.operational.sourceUrl);
 for(const change of [{auctionName:'USS Nagoya'},{mileageKm:12346},{lotNumber:'90'},{year:2021}])assert.equal(joinJapanInventory([drom,{...jp,...change}]).report.joined,0);
 const bad=structuredClone(jp);(bad.operational.raw as any).listingImage=(bad.operational.raw as any).listingImage.replace('bid=89','bid=90');assert.equal(joinJapanInventory([drom,bad]).report.joined,0);
 assert.equal(joinJapanInventory([drom,jp,{...jp,sourceOfferId:'another'}]).report.ambiguous,1);
 const injected=structuredClone(jp);injected.images=[{url:'https://unrelated.example/photo.jpg'}] as any;
 assert.ok(joinJapanInventory([drom,injected]).offers[0].images.every(img=>!img.url.includes('unrelated')));
});
