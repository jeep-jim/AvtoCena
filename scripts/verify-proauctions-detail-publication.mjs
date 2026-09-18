import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {readDataJson} from '../apps/web/lib/data.ts';
import {restoreProAuctionsPower} from '../apps/web/lib/catalog/proauctions-source-parameters.ts';
import {hashCatalogRows} from './lib/catalog-preservation-hash.mjs';
const priorReport=JSON.parse(await fs.readFile('prior-detail-report/japan-detail-recovery-report.json','utf8'));
const current=await readDataJson('catalog/manifest.json',null);
const previous=await readDataJson('catalog/previous-manifest.json',null);
assert.equal(current?.generationId,'gen_1789722333785_09d35723','unexpected_current_generation');
assert.equal(previous?.generationId,priorReport.previousGeneration,'unexpected_previous_generation');
const patches=new Map();
for(const file of await fs.readdir('proauctions-detail-patches'))if(/^\d+\.json$/.test(file)){
 const patch=JSON.parse(await fs.readFile(`proauctions-detail-patches/${file}`,'utf8'));patches.set(patch.id,patch);
}
async function marketRows(manifest,market){
 const chunks=manifest.markets[market].chunks,results=new Array(chunks.length);let cursor=0;
 await Promise.all(Array.from({length:4},async()=>{while(cursor<chunks.length){
  const index=cursor++,chunk=chunks[index];
  const path=chunk.startsWith('catalog/')?chunk:`catalog/generations/${manifest.generationId}/offers/${market}/${chunk}.json`;
  results[index]=await readDataJson(path,null);assert.ok(Array.isArray(results[index]),`missing_chunk:${path}`);
 }}));
 const rows=results.flat();assert.equal(rows.length,manifest.markets[market].count,`incomplete_market:${market}`);return rows;
}
const counts={},hashes={};let checkedJapan=0,sample;
for(const market of Object.keys(current.markets)){
 const rows=await marketRows(current,market);counts[market]=rows.length;hashes[market]=hashCatalogRows(rows);
 if(market!=='japan')assert.equal(hashes[market],priorReport.otherMarketHashes[market],`other_market_changed:${market}`);
 else {
  const old=await marketRows(previous,market);
  const expected=old.map(row=>{
   const patch=patches.get(row.id);assert.ok(patch,`missing_patch:${row.id}`);
   for(const key of ['sourceOfferId','sourcePrice','year','lotNumber','auctionDate'])assert.equal(String(patch[key]),String(row[key]),`identity_changed:${row.id}:${key}`);
   assert.equal(patch.sourceUrl,row.operational.sourceUrl);
   checkedJapan++;
   return {...restoreProAuctionsPower(row),images:[...row.images,...patch.sheets.filter(sheet=>!row.images.some(image=>image.url===sheet.url))]};
  });
  assert.equal(hashes[market],hashCatalogRows(expected),'japan_fields_or_gallery_order_changed');
  const car=rows.find(row=>row.id==='02defbbae91fe890a6b1dc3c');assert.ok(car);
  assert.equal(car.images.length,3);assert.equal(car.images.at(-1).url,patches.get(car.id).sheets[0].url);
  assert.equal(car.powerHp,140);assert.equal(car.powerKw,103);assert.equal(car.powerDataConfidence,'source_exact');
  sample={id:car.id,images:car.images.map(image=>image.url),powerHp:car.powerHp,powerKw:car.powerKw};
 }
 console.log(JSON.stringify({stage:'market_verified',market,count:rows.length}));
}
assert.equal((await readDataJson('catalog/manifest.json',null))?.generationId,current.generationId,'generation_changed_during_audit');
const report={published:true,verified:true,generationId:current.generationId,previousGeneration:previous.generationId,checkedJapan,sheetsAdded:priorReport.sheetsAdded,powerRestored:priorReport.powerRestored,counts,hashes,sample,verifiedAt:new Date().toISOString()};
await fs.writeFile('japan-detail-publication-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
