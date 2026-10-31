import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareGreenRefresh} from '../scripts/lib/green-refresh-snapshot.mjs';
import {normalizeGreenCorner} from '../apps/web/lib/catalog/green-corner-normalize';
const now='2026-10-31T16:00:00Z';
const terms={cifFreightJpy:74000,paymentQuote:{sell:56,nominal:100,fetchedAt:now}};
const rate:any={currency:'JPY',effectiveRate:.6,cbrRate:60,nominal:100,rateDate:'2026-10-31',rateSource:'cbr'};
const lot={id:1,company:'HONDA',model:'FIT',year:2020,priceInJapan:1000000,priceInJapanCurrency:'JPY',isSold:false,location:'japan',subgroup:'auto',media:['https://img.akebono.world/a.JPG'],engineVolumeNum:1500,horsepower:110};
const old=()=>normalizeGreenCorner({...lot,...terms},rate,now);
test('photo-less new lot is reported separately; other current lots publish',()=>{
 const r=prepareGreenRefresh({total:2,items:[lot,{...lot,id:2,media:[]}]},[],terms,rate,now);
 assert.equal(r.items.length,1);assert.deepEqual(r.missingPhotos,['2']);
});
test('same current lot retains its images and facts while refreshing price',()=>{
 const previous:any={...old(),powerHp:150,drive:'awd',fuel:'hybrid',firstSeenAt:'2026-09-01',savedCalculationPreview:{totalRub:1},totalRub:123};
 const before=JSON.stringify(previous);
 const r=prepareGreenRefresh({total:1,items:[{...lot,media:[],priceInJapan:1200000,horsepower:99}]},[previous],terms,rate,now);
 assert.deepEqual(r.reusedPhotos,['1']);const item=r.items[0];
 assert.equal(item.sourcePrice,1274000);assert.equal(item.sellerPriceRub,713440);assert.equal(item.totalRub,null);
 assert.equal(item.powerHp,150);assert.equal(item.drive,'awd');assert.equal(item.fuel,'hybrid');
 assert.deepEqual(item.operational,previous.operational);assert.deepEqual(item.images,previous.images);
 assert.equal(item.firstSeenAt,'2026-09-01');assert.equal(JSON.stringify(previous),before);
});
test('invalid price, currency, identity and collapse still block publication',()=>{
 assert.throws(()=>prepareGreenRefresh({total:1,items:[{...lot,priceInJapanCurrency:'USD'}]},[],terms,rate,now),/invalid_listing/);
 assert.throws(()=>prepareGreenRefresh({total:1,items:[lot]},[],terms,{...rate,rateDate:'2020-01-01'},now),/invalid_currency/);
 assert.throws(()=>prepareGreenRefresh({total:1,items:[{...lot,model:'CIVIC'}]},[old()],terms,rate,now),/identity_changed/);
 assert.throws(()=>prepareGreenRefresh({total:1,items:[lot]},Array.from({length:20},(_,i)=>({...old(),id:`green-${i+1}`})),terms,rate,now),/collapse/);
 assert.throws(()=>prepareGreenRefresh({total:1,items:[{...lot,media:[]}]},[],terms,rate,now),/empty/);
});
test('confirmed absence from complete scan removes an old lot; newcomers retain source facts',()=>{
 const previous=Array.from({length:10},(_,i)=>({...old(),id:`green-${i+1}`,sourceOfferId:String(i+1)}));
 const rows=Array.from({length:10},(_,i)=>({...lot,id:i+2}));
 const result=prepareGreenRefresh({total:10,items:rows},previous,terms,rate,now);
 assert.equal(result.items.length,10);assert.ok(!result.items.some(x=>x.id==='green-1'));
 assert.equal(result.items.find(x=>x.id==='green-11')?.powerHp,110);
});
