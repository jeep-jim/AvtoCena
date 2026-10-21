import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {directOfferEligible,directOfferXml,directFeedXml,DIRECT_CITY} from '../apps/web/lib/catalog/yandex-direct-feed';
import {directOfferScenario} from '../apps/web/lib/catalog/yandex-direct-scenario';
import {normalizeGreenCorner} from '../apps/web/lib/catalog/green-corner-normalize';
import {LocalJsonStorage} from '../apps/web/lib/data';
import {resetCatalogRateCache} from '../apps/web/lib/catalog/rates';
import {validateCustomerParameters} from '../apps/web/lib/catalog/customer-parameters';
import {calculateOfferWithCustomerParametersDetailed} from '../apps/web/lib/catalog/customs-pricing';
const now=Date.now();
const offer:any={id:'green-123',sourceId:'akebono_green_japan_open',sourceOfferId:'123',market:'japan',status:'active',offerType:'fixed',catalogKind:'listing',priceMode:'fixed',make:'Toyota',model:'A & <B>',year:2022,updatedAt:new Date(now).toISOString()};
test('advertising excludes sold auctions, expired, stale and unknown inventory',()=>{
 assert.equal(directOfferEligible(offer,now),true);
 for(const patch of [{status:'sold'},{status:'removed'},{status:'stale'},{catalogKind:'auction_result'},{offerType:'auction'},{market:'japan',sourceId:'proauctions_japan_stat'},{priceMode:'auction_start'},{updatedAt:'2020-01-01'},{expiresAt:'2020-01-01'},{updatedAt:'invalid'}])assert.equal(directOfferEligible({...offer,...patch},now),false,JSON.stringify(patch));
 assert.equal(directOfferEligible({...offer,market:'korea',sourceId:'kcar'},now),true);
});
test('XML has escaped identity, full RUB price, individual city landing and direct photos',()=>{
 const xml=directOfferXml(offer,1234567.8,['javascript:alert(1)','https://img.example/car.jpg?a=1&b=2']);
 assert.ok(xml);assert.match(xml,/<price>1234568<\/price>/);assert.match(xml,/<currency>RUB<\/currency>/);
 assert.match(xml,/A &amp; &lt;B&gt;/);assert.match(xml,/direct=novokuznetsk/);assert.match(xml,/a=1&amp;b=2/);
 assert.match(xml,/<availability>на заказ<\/availability>/);assert.doesNotMatch(xml,/javascript:|<vin>/);
 assert.equal(directOfferXml(offer,NaN,['https://example.com/a.jpg']),null);
 assert.equal(directOfferXml(offer,10,[]),null);
 assert.match(directFeedXml([xml]),/^<\?xml version="1.0" encoding="UTF-8"\?>/);
});
test('feed scenario replays the same landing calculator including Novokuznetsk delivery without writes',async()=>{
 const today=new Date().toISOString(),markets=JSON.parse(fs.readFileSync('data/markets/markets.json','utf8'));
 const prior=process.env.CATALOG_LIVE_RATE_DISABLED;process.env.CATALOG_LIVE_RATE_DISABLED='true';resetCatalogRateCache();
 const read=mock.method(LocalJsonStorage.prototype,'readJsonWithMeta',async(key:string)=>({found:true,value:key==='fees/exchange-rates.json'?{updatedAt:today,JPY:{cbrRate:66,nominal:100,rateDate:today,rateSource:'cbr'},EUR:{cbrRate:95,nominal:1,rateDate:today,rateSource:'cbr'},USD:{cbrRate:90,nominal:1,rateDate:today,rateSource:'cbr'}}:key==='markets/markets.json'?markets:null}));
 const write=mock.method(LocalJsonStorage.prototype,'writeJson',async()=>{throw Error('must not write');});
 try{
  const row=normalizeGreenCorner({id:123,company:'Toyota',model:'Corolla',year:2022,horsepower:122,engineVolumeNum:1600,fuel:'petrol',priceInJapan:1000000,priceInJapanCurrency:'JPY',cifFreightJpy:74000,paymentQuote:{sell:56.7,nominal:100,fetchedAt:today},isSold:false,location:'japan',subgroup:'auto',media:['https://img.akebono.world/a.JPG']},{currency:'JPY',effectiveRate:.66,cbrRate:66,nominal:100,rateDate:today,rateSource:'cbr'} as any,today);
  const original=JSON.stringify(row);
  const scenario=await directOfferScenario(row,true);assert.ok(scenario);assert.equal(scenario.draft.deliveryCity,DIRECT_CITY);
  const replay=await calculateOfferWithCustomerParametersDetailed(row,validateCustomerParameters(scenario.draft));assert.ok(replay.ok);
  assert.equal(replay.calculation.totalRub,scenario.calculation.totalRub);
  assert.equal(scenario.calculation.deliveryQuote?.amountRub,120000);
  assert.equal(JSON.stringify(row),original);assert.equal(write.mock.callCount(),0);
 }finally{read.mock.restore();write.mock.restore();if(prior===undefined)delete process.env.CATALOG_LIVE_RATE_DISABLED;else process.env.CATALOG_LIVE_RATE_DISABLED=prior;resetCatalogRateCache();}
});
