import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const offerId=id=>createHash('sha256').update('encar_direct:'+id).digest('hex').slice(0,24);
const fail=(v,c)=>assert.ok(v,'saved_coverage_'+c);
const MAX=500000;
export async function verifySavedEncarActualCoverage({readJson,observations,intake,preparation,snapshot,expected}){
 fail(expected&&/^[a-f0-9]{64}$/.test(expected.snapshotSha256)&&/^[a-f0-9]{64}$/.test(expected.intakeSha256)&&/^[a-f0-9]{64}$/.test(expected.preparationSha256),'external_pins');
 assert.equal(digest(snapshot),expected.snapshotSha256);assert.equal(digest(intake),expected.intakeSha256);assert.equal(digest(preparation),expected.preparationSha256);
 assert.equal(snapshot.producerSha,expected.producerSha);
 const s=intake.savedRevisionSelection,q=intake.savedRevisionQuarantine,src=intake.sources?.[0];
 fail(intake.completed&&intake.market==='korea'&&intake.provider==='auto_api_encar'&&intake.sources.length===1&&src.sourceId==='encar_direct','intake');
 assert.equal(intake.snapshotRun,expected.run);assert.equal(intake.snapshotAttempt,expected.attempt);
 const at=Date.parse(snapshot.completedAt);fail(Number.isSafeInteger(at)&&at>0,'timestamp');const iso=new Date(at).toISOString();
 assert.equal(Date.parse(intake.completedAt),at);
 assert.equal(s.snapshotSha256,expected.snapshotSha256);assert.deepEqual(preparation.savedRevisionSelection,s);
 for(const k of ['rawRows','publishableIds','supersededRows','quarantinedRows','uniqueIds','quarantinedIds'])fail(Number.isSafeInteger(s[k])&&s[k]>=0&&s[k]<=MAX,'count');
 assert.equal(s.rawRows,snapshot.count);assert.equal(s.rawRows,s.publishableIds+s.supersededRows+s.quarantinedRows);assert.equal(s.uniqueIds,s.publishableIds+s.quarantinedIds);
 assert.equal(digest(q),s.quarantineSha256);assert.equal(q.root,`catalog/intake-staging/encar/${expected.run}/${expected.attempt}`);assert.equal(q.entries.length,s.quarantinedIds);
 const quarantined=new Set();let qr=0;
 for(const e of q.entries){fail(/^\d{6,10}$/.test(e.sourceOfferId)&&!quarantined.has(offerId(e.sourceOfferId)),'quarantine_identity');quarantined.add(offerId(e.sourceOfferId));qr+=e.versions.length;}
 assert.equal(qr,s.quarantinedRows);
 if(quarantined.size){assert.equal(intake.paidInputWitness,undefined);assert.equal(intake.rawRetirementBlocked,'saved_revision_quarantine');}
 fail(preparation.completed===true,'preparation');assert.equal(preparation.snapshotDigest,expected.snapshotSha256);
 assert.equal(preparation.sourceRunId,expected.run);assert.equal(preparation.sourceRunAttempt,expected.attempt);assert.equal(preparation.observedAtMs,at);assert.equal(preparation.observedAt,iso);
 const root=`catalog/paid-encar-reports/v1/${at}/`;assert.equal(preparation.root,root);
 const complete=await readJson(root+'complete.json');assert.equal(digest(complete),preparation.completeDigest);
 for(const [k,v] of Object.entries({version:1,provider:'auto_api_encar',observedAt:iso,observedAtMs:at,sourceRunId:expected.run,sourceRunAttempt:expected.attempt,rowCount:s.publishableIds}))assert.equal(complete[k],v);
 fail([2,3].includes(complete.bucketPrefixLength),'prefix');assert.equal(preparation.rowCount,complete.rowCount);
 const rows=new Map();let bucketCount=0;
 for(const kind of ['history','inspection']){
  const descriptors=complete[kind];fail(descriptors&&typeof descriptors==='object'&&!Array.isArray(descriptors),'descriptors');const prefixes=Object.keys(descriptors).sort();fail(prefixes.length>0&&prefixes.length<=4096,'bucket_count');let count=0;
  for(const prefix of prefixes){fail(new RegExp(`^[a-f0-9]{${complete.bucketPrefixLength}}$`).test(prefix),'bucket_prefix');
   const b=await readJson(root+kind+'/'+prefix+'.json'),d=descriptors[prefix];fail(b&&Buffer.byteLength(JSON.stringify(b))<=4*1024*1024,'bucket_bytes');
   for(const [k,v] of Object.entries({version:1,provider:'auto_api_encar',observedAt:iso,observedAtMs:at,kind,prefix}))assert.equal(b[k],v);
   fail(Array.isArray(b.rows)&&b.rows.length>0&&b.rows.length<=2048,'bucket_rows');assert.equal(b.rows.length,d.count);assert.equal(digest(b.rows),d.sha256);
   for(const row of b.rows){fail(/^\d{6,10}$/.test(row.sourceOfferId)&&row.offerId===offerId(row.sourceOfferId)&&row.offerId.startsWith(prefix)&&!quarantined.has(row.offerId),'report_identity');
    if(kind==='history'){fail(!rows.has(row.offerId)&&rows.size<MAX,'report_duplicate');rows.set(row.offerId,{source:row.sourceOfferId,inspection:false,admitted:false});}
    else{const r=rows.get(row.offerId);fail(r&&r.source===row.sourceOfferId&&!r.inspection,'report_set');r.inspection=true;}
    count++;
   }bucketCount++;
  }assert.equal(count,complete.rowCount);
 }
 assert.equal(bucketCount,preparation.bucketCount);assert.equal(rows.size,s.publishableIds);for(const r of rows.values())fail(r.inspection,'inspection_missing');
 let admitted=0;
 for await(const observation of observations){const o=observation.offer;fail(observation.stage==='detail'&&Date.parse(observation.observedAt)===at&&o?.market==='korea'&&o.sourceId==='encar_direct'&&o.operational?.provider==='auto_api_encar','observation');
  fail(Date.parse(o.operational?.lastSeenAt || o.updatedAt || o.operational?.sourcePublishedAt || o.firstSeenAt)===at,'offer_observed_at');const r=rows.get(o.id);fail(r&&!r.admitted&&r.source===String(o.sourceOfferId)&&o.id===offerId(String(o.sourceOfferId))&&!quarantined.has(o.id),'observation_identity');r.admitted=true;admitted++;fail(admitted<=MAX,'observation_limit');
 }
 assert.equal(admitted,src.observations);assert.equal(admitted,src.uniqueOffers);assert.equal(admitted+src.excluded,s.publishableIds);assert.equal(src.superseded,s.supersededRows);assert.equal(src.quarantined,s.quarantinedRows);
 assert.equal(digest(await readJson(root+'complete.json')),preparation.completeDigest);
 const ids=[...rows.keys()].sort();const admittedIds=ids.filter(id=>rows.get(id).admitted);
 return {version:1,verified:true,observedAt:iso,reportRows:rows.size,normalizedRows:admitted,excludedRows:src.excluded,quarantinedIds:quarantined.size,bucketCount,reportIdsSha256:digest(ids),normalizedIdsSha256:digest(admittedIds),snapshotSha256:expected.snapshotSha256,intakeSha256:expected.intakeSha256,preparationSha256:expected.preparationSha256,completeSha256:preparation.completeDigest,supplierRequests:0,storageWrites:0};
}
