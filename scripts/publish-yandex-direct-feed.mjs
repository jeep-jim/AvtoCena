import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {DIRECT_CITY,DIRECT_MARKETS,DIRECT_FEED_META,directOfferEligible,directMarket,directOfferXml,directFeedXml} from '../apps/web/lib/catalog/yandex-direct-feed.ts';
import {directOfferScenario} from '../apps/web/lib/catalog/yandex-direct-scenario.ts';
import {rankedCatalogImageUrls} from '../apps/web/lib/catalog/image-quality.ts';
import {withGreenCornerFuel} from '../apps/web/lib/catalog/green-corner-fuel.ts';
const storage=getJsonStorage();
const manifest=await storage.readJson('catalog/manifest.json',null);
const green=await storage.readJson('catalog/green-corner/current.json',null);
if(!manifest?.generationId || !green?.updatedAt || !Array.isArray(green.items))throw Error('source_snapshot_missing');
const saved=await storage.readJson('offer-calculation-previews/current.json',{entries:{}});
const previous=await storage.readJson(DIRECT_FEED_META,null);
const slot=previous?.files?.['all.xml']?.path.includes('/a/')?'b':'a';
const cars=Object.fromEntries(DIRECT_MARKETS.map(m=>[m,[]]));
const seen=new Set(),report={startedAt:new Date().toISOString(),city:DIRECT_CITY,scanned:0,ineligible:0,incomplete:0,byMarket:{}};
async function addBatch(rows){
  // No entire-catalog copy or parallel shard downloads: bounded memory and I/O.
  for(let start=0;start<rows.length;start+=8){
    const results=await Promise.all(rows.slice(start,start+8).map(async offer=>{
      report.scanned++;
      if(!directOfferEligible(offer)||seen.has(offer.id)){report.ineligible++;return null;}
      seen.add(offer.id);
      const images=rankedCatalogImageUrls(offer);
      if(!images.length){report.incomplete++;return null;}
      const scenario=await directOfferScenario(offer,!saved.entries?.[offer.id]);
      const xml=scenario?directOfferXml(offer,scenario.calculation.totalRub,images):null;
      if(!xml){report.incomplete++;return null;}
      return {market:directMarket(offer),xml};
    }));
    for(const result of results)if(result)cars[result.market].push(result.xml);
  }
}
await addBatch(green.items.map(withGreenCornerFuel));
console.log(JSON.stringify({market:'green',count:cars.green.length}));
for(const market of DIRECT_MARKETS.filter(m=>m!=='green')){
  const entry=manifest.markets?.[market];
  if(!entry?.chunks?.length)throw Error(`market_snapshot_missing:${market}`);
  for(const chunk of entry.chunks){
    const path=chunk.startsWith('catalog/')?chunk:`catalog/generations/${manifest.generationId}/offers/${market}/${chunk}.json`;
    const rows=await storage.readJson(path,null);
    if(!Array.isArray(rows))throw Error(`invalid_chunk:${path}`);
    await addBatch(rows);
  }
  console.log(JSON.stringify({market,count:cars[market].length,scanned:report.scanned}));
}
const latest=await storage.readJson('catalog/manifest.json',null);
const latestGreen=await storage.readJson('catalog/operations/markets/green.json',null);
if(latest?.generationId!==manifest.generationId || latestGreen?.publishedAt && latestGreen.publishedAt!==green.updatedAt)throw Error('source_changed_retry_next_run');
if(!cars.green.length)throw Error('green_feed_empty');
const files={};
for(const name of ['all',...DIRECT_MARKETS]){
  const entries=name==='all'?DIRECT_MARKETS.flatMap(m=>cars[m]):cars[name];
  if(!entries.length)continue;
  const xml=directFeedXml(entries);
  if(Buffer.byteLength(xml)>512*1024*1024)throw Error(`feed_exceeds_direct_limit:${name}`);
  const data=gzipSync(xml);
  if(data.length>64*1024*1024)throw Error(`feed_storage_budget_exceeded:${name}`);
  const path=`catalog/advertising/yandex/${slot}/${name}.xml.gz`;
  await storage.putBinary(path,data,'application/gzip');
  const verified=await storage.getBinary(path);
  const sha256=createHash('sha256').update(data).digest('hex');
  if(createHash('sha256').update(verified.data).digest('hex')!==sha256)throw Error('upload_verification_failed');
  files[`${name}.xml`]={path,count:entries.length,bytes:data.length,sha256};
}
const metadata={version:1,generatedAt:new Date().toISOString(),generationId:manifest.generationId,greenUpdatedAt:green.updatedAt,city:DIRECT_CITY,files};
await storage.writeJson(DIRECT_FEED_META,metadata);
report.byMarket=Object.fromEntries(DIRECT_MARKETS.map(m=>[m,cars[m].length]));
Object.assign(report,{status:'published',...metadata});
await fs.writeFile('yandex-direct-feed-report.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
