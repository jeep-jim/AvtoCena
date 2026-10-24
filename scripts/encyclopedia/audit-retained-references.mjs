import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import fs from 'node:fs/promises';

export const ROOT='knowledge/encyclopedia/reference-intake/v1';
const digest=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
export const categories={fuel:/^Используемое топливо$/i,engineCc:/^Об[ъь][её]м двигателя, куб\.см$/i,engineCode:/^Марка двигателя$/i,power:/^(?:Максимальная мощность, л\.с\.|Мощность, л\.с\.$)/i,drive:/^(?:Тип привода|Привод)$/i,chassis:/^(?:Марка кузова|Код кузова)$/i,body:/^Тип кузова$/i,transmission:/^(?:Коробка передач|Тип трансмиссии)$/i,power30:/^Электродвигатель: 30-минутная мощность, л\.с\.$/i};
const errorCategory=x=>String(x||'').match(/redirect_outside_catalog|robots_disallow|HTTP Error \d{3}|timeout|timed out|captcha|access denied/i)?.[0]||'unclassified';

// Inventory only. Counts are not verified specifications, donors or calculated cars.
export async function auditRetainedReferences(storage,{concurrency=6,review}={}){
 if(review && (!Array.isArray(review.groups)||review.groups.length<1||review.groups.length>3||new Set(review.groups).size!==review.groups.length||review.groups.some(g=>!/^[-a-z0-9_]+\/[-a-z0-9_]+$/.test(g))||!Number.isInteger(review.year)||review.year<2008||review.year>new Date().getUTCFullYear()+1||review.afterDigest!==undefined&&!/^[a-f0-9]{64}$/.test(review.afterDigest)))throw Error('invalid_reference_review_scope');
 const reviewRows=[];let reviewMatches=0;

 if(!storage.listObjects)throw Error('listing_required');
 const before=await storage.readJson(`${ROOT}/state.json`,null);
 if(!before)throw Error('reference_checkpoint_missing');
 const objects=await storage.listObjects(`${ROOT}/records/`);
 const keys=objects.map(o=>o.key).sort();
 if(new Set(keys).size!==keys.length||keys.some(k=>!new RegExp(`^${ROOT}/records/[a-f0-9]{64}\\.json$`).test(k)))throw Error('invalid_reference_object_list');
 const report={version:2,checkedAt:new Date().toISOString(),scope:'retained_unverified_reference_inventory',storageWrites:0,supplierRequests:0,verifiedFieldsAdded:0,
  checkpoint:{digest:digest(before),saved:before.saved,visited:before.visited?.length,pending:before.pending?.length,updatedAt:before.updatedAt,failures:(before.failed||[]).slice(-5).map(f=>({at:f.at,category:errorCategory(f.message)}))},
  recordsListed:keys.length,recordsRead:0,eligiblePeriods:0,unknownOrInvalidPeriods:0,fieldLabels:{},fieldPresence:{},groups:[],classification:{},rawCorpusExported:false};
 const groups=new Map(),fingerprints=[];let cursor=0;
 await Promise.all(Array.from({length:Math.max(1,Math.min(8,concurrency))},async()=>{
  for(;;){const key=keys[cursor++];if(!key)return;
   const row=await storage.readJson(key,null);if(!row?.url||!row.facts)throw Error('reference_record_missing');
   const u=new URL(row.url),parts=u.pathname.split('/').filter(Boolean);
   if(u.protocol!=='https:'||u.hostname!=='www.drom.ru'||parts[0]!=='catalog'||u.search||u.hash||key!==`${ROOT}/records/${digest(row.url)}.json`)throw Error('reference_source_identity_mismatch');
   report.recordsRead++;fingerprints.push([key,digest(row)]);
   const classification=String(row.verification||'missing');report.classification[classification]=(report.classification[classification]||0)+1;
   const years=[...String(row.period||'').matchAll(/\b(?:19|20)\d{2}\b/g)].map(m=>Number(m[0]));
   const eligible=years.length===2&&years[0]<=years[1]&&years[1]>=2008;
   eligible?report.eligiblePeriods++:report.unknownOrInvalidPeriods++;
   const groupKey=parts.slice(1,3).join('/');
   if(review && review.groups.includes(groupKey) && eligible && years[0]<=review.year && years[1]>=review.year){
    const recordDigest=digest(row.url);
    if(!review.afterDigest || recordDigest>review.afterDigest){
     reviewMatches++;
     const facts=Object.fromEntries(Object.entries(row.facts).filter(([label])=>Object.values(categories).some(re=>re.test(label))));
     if(Object.values(facts).some(v=>typeof v!=='string'||v.length>500)||String(row.period).length>500)throw Error('invalid_reference_fact_size');
     reviewRows.push({recordDigest,contentDigest:digest(row),url:row.url,sourceModelGroup:groupKey,sourceKind:row.sourceKind,verification:row.verification,retrievedAt:row.retrievedAt,period:row.period,facts});
     reviewRows.sort((a,b)=>a.recordDigest.localeCompare(b.recordDigest));
     if(reviewRows.length>64)reviewRows.pop();
    }
   }
   let g=groups.get(groupKey);if(!g){g={sourceModelGroup:groupKey,records:0,withExplicitPeriod:0,fieldPresence:{},chassisYearGroups:new Set(),exampleRecordDigests:[]};groups.set(groupKey,g);}
   g.records++;if(eligible)g.withExplicitPeriod++;
   g.exampleRecordDigests=[...g.exampleRecordDigests,digest(row.url)].sort().slice(0,3);
   const labels=Object.keys(row.facts);for(const label of labels)report.fieldLabels[label]=(report.fieldLabels[label]||0)+1;
   for(const [category,re]of Object.entries(categories))if(labels.some(l=>re.test(l)&&String(row.facts[l]).trim())){report.fieldPresence[category]=(report.fieldPresence[category]||0)+1;g.fieldPresence[category]=(g.fieldPresence[category]||0)+1;}
   const chassis=labels.filter(l=>categories.chassis.test(l)).map(l=>String(row.facts[l]).trim()).filter(Boolean);
   if(eligible&&chassis.length===1)g.chassisYearGroups.add(digest([years,chassis[0]]));
  }
 }));
 const after=await storage.readJson(`${ROOT}/state.json`,null);
 if(digest(after)!==digest(before))throw Error('reference_checkpoint_changed');
 report.recordSnapshotDigest=digest(fingerprints.sort(([a],[b])=>a.localeCompare(b)));
 report.checkpointCountMatches=before.saved===report.recordsRead;
 report.groups=[...groups.values()].map(g=>({...g,chassisYearGroups:g.chassisYearGroups.size,exampleRecordDigests:g.exampleRecordDigests.sort()})).sort((a,b)=>b.records-a.records||a.sourceModelGroup.localeCompare(b.sourceModelGroup));
 if(review)report.review={...review,rows:reviewRows,remainingAfterPage:Math.max(0,reviewMatches-reviewRows.length),nextAfterDigest:reviewRows.at(-1)?.recordDigest||null,scope:'unverified_technical_facts_for_human_review_only',verifiedFieldsAdded:0};
 report.nextAction='Review retained technical groups against exact existing annual identities; none of these unverified rows is an ASTRA donor or approved calculation fact. No new years, variants or 30-minute values inferred.';
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const {getJsonStorage}=await import('../../apps/web/lib/data.ts');const storage=getJsonStorage();
 if(storage.driver!=='object')throw Error('durable_object_storage_required');
 storage.writeJson=async()=>{throw Error('reference_audit_read_only');};
 const marker=JSON.parse(await fs.readFile('.github/market-runs/encyclopedia-retained-reference-audit.json','utf8'));
 const report=await auditRetainedReferences(storage,{review:marker.review});await fs.mkdir('reports',{recursive:true});
 await fs.writeFile('reports/retained-reference-inventory.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({...report,groups:undefined,fieldLabels:undefined,review:report.review?{rows:report.review.rows.length,remainingAfterPage:report.review.remainingAfterPage}:undefined}));
}
