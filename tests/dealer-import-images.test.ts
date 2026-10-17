import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceImages} from '../apps/web/lib/autocalc/source-images';
import {offerImages} from '../apps/web/lib/catalog/offer-images';
import {importedOffer} from '../apps/web/lib/dealers/import-offer';
import {extractSource} from '../apps/web/lib/autocalc/source';
test('photo variants collapse and all current-offer JSON photos are read up to 30',()=>{
 const urls=Array.from({length:45},(_,i)=>`https://avatars.mds.yandex.net/get-autoru/1/photo${i}/1200x900`);
 const state={offer:{id:'12345678',photos:urls.map(original=>({original,small:original.replace('1200x900','320x240')}))},related:[{id:'88888888',photos:['https://example.com/other.jpg']}]};
 const html=`<script>window.__initialState__ = ${JSON.stringify(state)};</script>`;
 const images=sourceImages(html,'https://auto.ru/cars/used/sale/toyota/rav_4/12345678/',[urls[0].replace('1200x900','320x240')]);
 assert.equal(images.length,30);assert.equal(new Set(images.map(x=>x.split('/').slice(0,-1).join('/'))).size,30);assert.ok(!images.some(x=>x.includes('other')));
 assert.equal(offerImages(['https://example.com/a.jpg?w=10','https://example.com/a.jpg?w=100','https://example.com/b.jpg']).length,2);
});
test('structured galleries support more than 20 photos; specifications import excludes commercial content',()=>{
 const data=extractSource(`<script type="application/ld+json">${JSON.stringify({'@type':'Car',name:'Toyota RAV4',description:'Seller description',color:'Red',offers:{price:34000,priceCurrency:'USD'},image:Array.from({length:35},(_,i)=>`https://example.com/${i}.jpg`)})}</script>`,'https://example.com/car');
 assert.equal(data.images.length,30);const patch=importedOffer(data,'specs');assert.equal(patch.color,'Red');for(const k of ['priceUsd','description','photos','sourceUrl'])assert.ok(!(k in patch));assert.equal(importedOffer(data).priceUsd,34000);
});
