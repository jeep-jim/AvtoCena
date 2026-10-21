import test from 'node:test';
import assert from 'node:assert/strict';
import {compactPublicStorageOffer,isPublicOffer} from '../apps/web/lib/catalog/storage';
const offer=():any=>({id:'geo-photo',sourceId:'autopapa_georgia_open',sourceOfferId:'100',market:'georgia',status:'active',make:'Toyota',model:'Corolla',year:2022,sourcePrice:10000,sourceCurrency:'USD',catalogPricingMode:'seller',sellerPriceRub:900000,calculationStatus:'needs_data',totalRub:null,calculationSnapshot:{currencyRate:{currency:'USD',sourcePrice:10000,effectiveRate:90,rateSource:'cbr'}},images:Array.from({length:5},(_,i)=>({id:`photo-${i}`,url:`https://car-photo-source.example/listing-100/photo-${i}.jpg`,width:1280,height:853,size:0,mimeType:'image/jpeg'})),operational:{sourceUrl:'https://autopapa.ge/en/car/100',raw:{listingBoundImages:true}}});
test('Georgian source-price inventory preserves photo attestation through compaction',()=>{
 const original=offer();assert.equal(isPublicOffer(original),true);
 const compact=compactPublicStorageOffer(original);
 assert.equal(compact.operational.raw,undefined);assert.equal(isPublicOffer(compact),true);
 assert.equal(isPublicOffer(compactPublicStorageOffer(compact)),true);
 assert.equal(original.operational.raw.listingBoundImages,true);
 for(const flag of [false,undefined]){const invalid=offer();invalid.operational.raw.listingBoundImages=flag;assert.equal(isPublicOffer(compactPublicStorageOffer(invalid)),false);}
});
