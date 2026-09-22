import {collectGreenCorner,assertGreenPublication} from './lib/akebono-green-source.mjs';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {convertToRub} from '../apps/web/lib/catalog/rates.ts';
import {normalizeGreenCorner} from '../apps/web/lib/catalog/green-corner-normalize.ts';
import fs from 'node:fs/promises';
import {createGreenCornerLogistics,greenCornerLogisticsRub} from '../apps/web/lib/catalog/green-corner-contract.ts';
const storage=getJsonStorage(),key='catalog/green-corner/current.json';
// Read the baseline BEFORE collection; an older run may never overwrite a newer publication.
const baseline=await storage.readJsonWithMeta(key,null);
if(baseline.found&&!baseline.etag)throw Error('green_missing_conditional_write_etag');
const source=await collectGreenCorner();
const rate=await convertToRub(1,'JPY');
const now=new Date().toISOString();
const logistics=baseline.value?.logistics || createGreenCornerLogistics(rate);
greenCornerLogisticsRub(logistics,rate.effectiveRate);
const previousById=new Map((baseline.value?.items||[]).map(row=>[row.id,row]));
const normalized=source.items.map(row=>{const offer=normalizeGreenCorner(row,rate,now);return {...offer,greenCornerLogistics:logistics,firstSeenAt:previousById.get(offer.id)?.firstSeenAt||now};});
// Keep the existing global 15m ceiling. Do not apply auction retention or non-Japan year quotas.
const items=normalized.filter(row=>row.sellerPriceRub<=15_000_000).sort((a,b)=>b.year-a.year||a.id.localeCompare(b.id));
assertGreenPublication(baseline.value?.items?.length||0,items.length,source.total);
const snapshot={version:1,updatedAt:now,sourceCount:source.total,logistics,items};
await storage.writeJson(key,snapshot,baseline.found?{ifMatch:baseline.etag}:{ifNoneMatch:'*'});
const verified=await storage.readJson(key,null);
if(verified?.updatedAt!==now||verified.items?.length!==items.length)throw Error('green_publication_verification_failed');
const report={status:'published',lastCollectionSuccess:now,lastPublicationSuccess:now,publishedAt:now,sourceCount:source.total,publishedCount:items.length,overPriceCap:normalized.length-items.length};
await storage.writeJson('catalog/operations/markets/green.json',report);
await fs.writeFile('catalog-green-report.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
