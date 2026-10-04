import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {getJsonStorage,readDataJson} from '../apps/web/lib/data.ts';
import {buildBudgetCountIndex} from '../apps/web/lib/catalog/budget-count-index.ts';
import {applyActiveBusinessPriceBatch} from '../apps/web/lib/catalog/live-business-pricing.ts';
import {attachJapanSearchValues} from '../apps/web/lib/catalog/japan-delivered-preview.ts';
const storage=getJsonStorage();
for(const name of ['writeJson','putBinary','deleteObject'])storage[name]=async()=>{throw Error('diagnostic_read_only');};
if(!process.argv.includes('--verify')){
 const manifest=await readDataJson('catalog/manifest.json',{});
 const old=await readDataJson(`catalog/generations/${manifest.generationId}/indexes/budget-count-v2.json`,null);
 const blocks=[...new Set([...old.rows,...old.otherRows].map(row=>row[5].block))];
 const index={version:3,filterVersion:1,generationId:manifest.generationId,sourceRows:old.sourceRows,rows:[],otherRows:[]};
 let cursor=0;
 await Promise.all(Array.from({length:4},async()=>{while(cursor<blocks.length){const block=blocks[cursor++];const part=await readDataJson(`catalog/generations/${manifest.generationId}/indexes/budget-cards-v2/${block}.json`,null);assert.equal(part.generationId,index.generationId);const next=buildBudgetCountIndex(index.generationId,part.items,new Map(part.items.map(row=>[row.id,block])),3);index.rows.push(...next.rows);index.otherRows.push(...next.otherRows);}}));
 fs.writeFileSync('/tmp/budget-v3.json',JSON.stringify(index));
 console.log(JSON.stringify({phase:'derived-locally-only',bytes:fs.statSync('/tmp/budget-v3.json').size,rows:index.rows.length,other:index.otherRows.length}));
 const result=spawnSync(process.execPath,['--import','tsx',process.argv[1],'--verify'],{stdio:'inherit'});process.exit(result.status||0);
}
const started=performance.now();
const index=JSON.parse(fs.readFileSync('/tmp/budget-v3.json','utf8'));
console.log(JSON.stringify({phase:'parse',ms:Math.round(performance.now()-started),rssMb:Math.round(process.memoryUsage().rss/1048576)}));
const original=storage.readJsonWithMeta.bind(storage);
storage.readJsonWithMeta=async(key,fallback)=>key.endsWith('/budget-count-v3.json')?{found:true,value:index}:original(key.replace('/budget-cards-v3/','/budget-cards-v2/'),fallback);
const {searchOffers,countCatalogOffers,searchOffersWithoutBudgetIndexForTests}=await import('../apps/web/lib/catalog/storage.ts');
for(const market of ['korea','any']){
 const start=performance.now();const params={market,budgetTo:2000000,pageSize:24};const result=await searchOffers(params);
 const price=await attachJapanSearchValues(await applyActiveBusinessPriceBatch(result.items,{readOnly:true}),result.generationId);
 const invalid=price.filter(row=>Number(row.japanDeliveredPreview?.totalRub||row.totalRub)>2000000).map(row=>({id:row.id,total:row.totalRub}));
 console.log(JSON.stringify({market,total:result.total,ms:Math.round(performance.now()-start),rssMb:Math.round(process.memoryUsage().rss/1048576),invalid}));assert.equal(invalid.length,0);
 const warm=performance.now();const count=await countCatalogOffers(params);console.log(JSON.stringify({market,count:count.total,warmMs:Math.round(performance.now()-warm)}));assert.equal(count.total,result.total);
 if(market==='korea'){const baseline=await searchOffersWithoutBudgetIndexForTests(params);assert.equal(baseline.total,result.total);assert.deepEqual(result.items.map(row=>row.id),baseline.items.map(row=>row.id));console.log('Korean exact full-projection parity passed');}
}

const lock=await readDataJson('catalog/import-lock.json',null);console.log(JSON.stringify({phase:'publisher-lock',lock}));
