import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';

export async function checkEuropeStorefront(report,request=fetch){
 const expected=report.publishedMarketCount;
 assert(report.market==='europe'&&report.published===true&&Number.isSafeInteger(expected)&&expected>0,'missing_europe_publication');
 assert.deepEqual(report.byMarketAndSource?.europe,{autoscout_europe_open:expected},'unexpected_published_europe_source');
 async function get(path){
  const started=performance.now();
  const response=await request('https://avtocena.com/api/catalog/'+path,{headers:{accept:'application/json','cache-control':'no-cache'},signal:AbortSignal.timeout(30000)});
  assert(response.ok,'storefront_http_'+response.status);
  const data=await response.json();
  assert(data.ok===true&&data.generationId,'invalid_europe_storefront_response');
  return {data,ms:Math.round(performance.now()-started)};
 }
 const counts=await get('market-counts');
 const page=await get('search?market=europe&marketPage=1&page=1');
 const filtered=await get('search?market=europe&marketPage=1&powerTo=160&page=1');
 assert.equal(counts.data.markets.europe,expected,'public_europe_count');
 assert.equal(page.data.total,expected,'public_europe_page_count');
 for(const result of [page,filtered]){
  const {data}=result;
  assert.equal(data.generationId,counts.data.generationId,'catalog_changed_during_check');
  assert(Number.isSafeInteger(data.total)&&data.total>=0&&data.total<=expected,'public_europe_filter_count');
  assert(Array.isArray(data.items)&&data.items.length===Math.min(data.total,24),'public_europe_page_size');
  for(const item of data.items){
   assert(item.id&&item.market==='europe'&&Number(item.year)>=2022,'public_europe_card_scope');
   if(item.sourceId)assert.equal(item.sourceId,'autoscout_europe_open','public_europe_retired_source');
  }
 }
 for(const item of filtered.data.items){
  if(Number(item.powerHp)>0)assert(Number(item.powerHp)<=160,'public_europe_filter_power');
 }
 return {publishedGeneration:report.generationId,visibleGeneration:counts.data.generationId,
  count:expected,filter160Count:filtered.data.total,firstPageCards:page.data.items.length,
  elapsedMs:{counts:counts.ms,page:page.ms,filter:filtered.ms}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const report=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
 for(let attempt=1;;attempt++){
  try{console.log(JSON.stringify(await checkEuropeStorefront(report)));break;}
  catch(error){if(attempt>=4)throw error;await delay(30000);}
 }
}
