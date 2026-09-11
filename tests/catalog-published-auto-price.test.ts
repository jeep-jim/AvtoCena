import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {prepareSellerInventory} from '../apps/web/lib/catalog/prepare-seller-inventory';
import {LocalJsonStorage} from '../apps/web/lib/data';
import {resetCatalogRateCache} from '../apps/web/lib/catalog/rates';
import {searchProjectionFromOffer} from '../apps/web/lib/catalog/storage';

test('complete source evidence calculates before projecting cards in each non-Japan market',async()=>{
 const previous=process.env.CATALOG_LIVE_RATE_DISABLED;process.env.CATALOG_LIVE_RATE_DISABLED='true';resetCatalogRateCache();
 const now=new Date().toISOString();
 const read=mock.method(LocalJsonStorage.prototype,'readJsonWithMeta',async(key:string)=>({found:true,value:key==='fees/exchange-rates.json'?{updatedAt:now,EUR:{cbrRate:95,nominal:1,rateDate:now,rateSource:'cbr'}}:[]}));
 try {
  for(const market of ['korea','china','uae','georgia','europe']) {
   const offer:any={id:`${market}:complete`,sourceId:'test_source',sourceOfferId:'123',market,make:'Toyota',model:'Corolla',year:2022,fuel:'petrol',powertrainKind:'combustion',engineCc:1598,powerHp:122,powerDataConfidence:'source_exact',powerDataSource:'source_listing',sourcePrice:1000000,sourceCurrency:'RUB',status:'active',catalogPricingMode:'seller',sellerPriceRub:1000000,images:[{url:'https://example.test/car.jpg',size:100000}],operational:{sourceUrl:'https://example.test/car/123',exactDetail:true,semanticEvidence:Object.fromEntries(Object.entries({year:2022,fuel:'petrol',powertrainKind:'combustion',engineCc:1598,powerHp:122}).map(([key,value])=>[key,{source:'source_listing',status:'exact',value}]))}};
   const sources:any={korea:['encar_direct','https://fem.encar.com/cars/detail/123'],china:['autohome_used_china_open','https://www.che168.com/dealer/123/12345678.html'],uae:['dubizzle_uae_open','https://dubai.dubizzle.com/motors/used-cars/toyota/corolla/123'],georgia:['myauto_georgia_list','https://www.myauto.ge/en/pr/123'],europe:['mobile_de_open','https://suchen.mobile.de/fahrzeuge/details.html?id=123']};
   [offer.sourceId,offer.operational.sourceUrl]=sources[market];
   offer.images=Array.from({length:5},(_,i)=>({url:`https://img.autoimg.cn/vehicle-${i}.jpg`,size:100000}));
   Object.assign(offer.operational,{galleryVerified:true,exactPhotos:true,galleryImageCount:5,photoIdentityVerified:true});
   const result=await prepareSellerInventory(offer,{preservePublishedPrice:true});
   assert.ok(result,market);assert.ok(Number(result.totalRub)>1000000,`${market}: ${JSON.stringify(result.calculationSnapshot)}`);
   assert.equal(result.catalogPricingMode,undefined);assert.equal(searchProjectionFromOffer(result).totalRub,result.totalRub,market);
  }
 } finally {read.mock.restore();resetCatalogRateCache();if(previous===undefined)delete process.env.CATALOG_LIVE_RATE_DISABLED;else process.env.CATALOG_LIVE_RATE_DISABLED=previous;}
});
