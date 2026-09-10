import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {dromDetail} from '../apps/web/lib/catalog/drom-japan-source';
import {prepareSellerInventory} from '../apps/web/lib/catalog/prepare-seller-inventory';
import {LocalJsonStorage} from '../apps/web/lib/data';
import {resetCatalogRateCache} from '../apps/web/lib/catalog/rates';
import {japanAuctionSoldPriceVerified} from '../apps/web/lib/catalog/public-priority';
import {previewCanonicalPublicCatalogOffers,projectionCanRenderCard,searchProjectionFromOffer} from '../apps/web/lib/catalog/storage';
const fixture=JSON.parse(fs.readFileSync('tests/fixtures/drom/vitz-sold.json','utf8'));
const html=(f=fixture)=>`Продан за<script type="application/ld+json">${JSON.stringify(f.car)}</script><script data-drom-module="auction-statistics-lot">${JSON.stringify(f.module)}</script>`;
test('Drom price is JPY sold price, one lot photograph, no invented technical inputs',()=>{
 const o=dromDetail(html(),fixture.sourceUrl);
 assert.equal(o.sourcePrice,308000);assert.equal(o.auctionGrade,'4');assert.equal(o.auctionDate,'2026-09-08');assert.equal(o.images.length,1);assert.equal(o.engineCc,undefined);assert.equal(o.powerHp,undefined);assert.equal(o.fuel,undefined);assert.equal(japanAuctionSoldPriceVerified(o),true);
 const single=structuredClone(fixture);single.car.offers=single.car.offers.find((o:any)=>o.priceCurrency==='JPY');assert.equal(dromDetail(html(single),single.sourceUrl).sourcePrice,308000);
 for(const change of ['id','price','image','sold']){
  const f=structuredClone(fixture);
  if(change==='id')f.module.lot.lotId++;
  if(change==='price')f.module.lot.priceYen++;
  if(change==='image')f.module.lot.image.original=f.module.lot.image.original.replace('76511','76512');
  assert.throws(()=>dromDetail(change==='sold'?html(f).replace('Продан за','Стартовая цена'):html(f),f.sourceUrl));
 }
});
test('Drom missing specs survive seller-only preparation and canonical publication with one photograph',async()=>{
 const previous=process.env.CATALOG_LIVE_RATE_DISABLED;process.env.CATALOG_LIVE_RATE_DISABLED='true';resetCatalogRateCache();
 const today=new Date().toISOString();
 const read=mock.method(LocalJsonStorage.prototype,'readJsonWithMeta',async(key:string)=>({found:true,value:key==='fees/exchange-rates.json'?{updatedAt:today,JPY:{cbrRate:60,nominal:100,rateDate:today,rateSource:'cbr'}}:{}}));
 try{const o=await prepareSellerInventory(dromDetail(html(),fixture.sourceUrl));assert.ok(o);assert.equal(o.sellerPriceRub,184800);assert.equal(o.totalRub,null);const preview=await previewCanonicalPublicCatalogOffers([o]);assert.equal(preview.offers.length,1,JSON.stringify(preview.qualityRejected));const p=searchProjectionFromOffer(preview.offers[0]);assert.equal(projectionCanRenderCard(p),true);}
 finally{read.mock.restore();resetCatalogRateCache();if(previous===undefined)delete process.env.CATALOG_LIVE_RATE_DISABLED;else process.env.CATALOG_LIVE_RATE_DISABLED=previous;}
});
