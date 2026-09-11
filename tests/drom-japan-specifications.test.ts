import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dromDetail } from '../apps/web/lib/catalog/drom-japan-source';
import { enrichDromJapanSpecifications } from '../apps/web/lib/catalog/drom-japan-specifications';
import { specificationEvidenceComplete } from '../apps/web/lib/catalog/modification-matching';
import { prepareSellerInventory } from '../apps/web/lib/catalog/prepare-seller-inventory';
import { LocalJsonStorage } from '../apps/web/lib/data';
import { resetCatalogRateCache } from '../apps/web/lib/catalog/rates';
const fixture = (name: string) => fs.readFileSync(`tests/fixtures/drom/${name}`, 'utf8');
const f = JSON.parse(fixture('wagon-sold.json'));
const moduleHtml = (name: string, data: string) => `<script data-drom-module="${name}">${data}</script>`;
const offer = () => dromDetail(`Продан за<script type="application/ld+json">${JSON.stringify(f.car)}</script>${moduleHtml('auction-statistics-lot',JSON.stringify(f.module))}`,f.sourceUrl);
const read = async (url: string) => url.endsWith('/wagon_r/') ? moduleHtml('catalog-generations-page',fixture('wagon-generations.json'))
 : url.includes('/g_') ? moduleHtml('catalog-complectations-table',fixture('wagon-complectations.json')) : fixture('wagon-specs.html');
test('Wagon R sold lot gains exact calculation inputs from chassis/year/trim consensus', async () => {
 const o = await enrichDromJapanSpecifications(offer(),read);
 assert.equal(o.engineCc,657); assert.equal(o.powerHp,49); assert.equal(o.fuel,'petrol');
 assert.equal(o.sourcePrice,1033000); assert.equal(o.images.length,1);
 assert.equal(specificationEvidenceComplete(o),true);
});
test('catalog disagreement, unknown trim, unavailable catalogue and hybrid ambiguity cannot produce full inputs', async () => {
 for (const mode of ['conflict','trim','unavailable','hybrid']) {
  const o=offer(); if(mode==='trim')o.trim='UNKNOWN';
  const result=await enrichDromJapanSpecifications(o,async url => {
   if(mode==='unavailable')throw Error('unavailable');
   let html=await read(url);
   if(mode==='conflict' && url.endsWith('/436121/'))html=html.replace('657','658');
   if(mode==='hybrid')html=html.replace('0.7 л, 49 л.с., бензин','0.7 л, 49 л.с., гибрид');
   return html;
  });
  assert.equal(specificationEvidenceComplete(result),false,mode);
  assert.equal(result.sourcePrice,1033000,mode);
 }
});
test('confirmed Wagon R reaches a delivered calculation, not merely currency conversion', async () => {
 const prev=process.env.CATALOG_LIVE_RATE_DISABLED; process.env.CATALOG_LIVE_RATE_DISABLED='true'; resetCatalogRateCache();
 const now=new Date().toISOString();
 const storage=mock.method(LocalJsonStorage.prototype,'readJsonWithMeta',async(key:string)=>({found:true,value:key==='fees/exchange-rates.json'?{updatedAt:now,JPY:{cbrRate:60,nominal:100,rateDate:now,rateSource:'cbr'},EUR:{cbrRate:100,nominal:1,rateDate:now,rateSource:'cbr'},USD:{cbrRate:90,nominal:1,rateDate:now,rateSource:'cbr'}}:[]}));
 try {
  const result=await prepareSellerInventory(await enrichDromJapanSpecifications(offer(),read));
  assert.ok(result); assert.ok(Number(result.totalRub)>1033000*0.6,JSON.stringify({status:result.calculationStatus,total:result.totalRub,snapshot:result.calculationSnapshot}));
 } finally {storage.mock.restore();resetCatalogRateCache();if(prev===undefined)delete process.env.CATALOG_LIVE_RATE_DISABLED;else process.env.CATALOG_LIVE_RATE_DISABLED=prev;}
});
