import fs from 'node:fs/promises';
import {getJsonStorage,mutateDataJson} from '../../apps/web/lib/data.ts';
import {ROOT} from '../../apps/web/lib/encyclopedia/records.ts';
import {digest} from './research-batch.mjs';
const dir='docs/encyclopedia/japan-chassis-drive-2026-10-25';
const manifest=JSON.parse(await fs.readFile(`${dir}/manifest.json`,'utf8'));
if(manifest.version!==1||!manifest.parts.length||manifest.parts.length>64)throw Error('invalid_manifest');
const store=getJsonStorage();if(store.driver!=='object')throw Error('durable_object_storage_required');
const dryRun=process.argv.includes('--dry-run'),parts=[];
// Explicitly reviewed reproductions of original factory tables, not general
// permission to accept third-party catalogs as manufacturer evidence.
const reviewedFactoryArchives=new Set([
 'https://autocatalogarchive.com/wp-content/uploads/2016/08/Ford-Fiesta-2014-JP.pdf',
 'https://www.need.co.jp/wp-content/uploads/2025/04/doc-20200810_01.pdf',
]);
for(const p of manifest.parts){
 if(!/^part-\d{4}\.json$/.test(p.path))throw Error('invalid_part');
 const rows=JSON.parse(await fs.readFile(`${dir}/${p.path}`,'utf8'));
 if(rows.length>64||rows.length!==p.rows||digest(rows)!==p.sha256)throw Error('part_digest_mismatch');
 for(const r of rows){
  if(!r.make||!r.chassisCode||!Array.isArray(r.drives)||r.drives.some(d=>!['fwd','rwd','awd'].includes(d)))throw Error('invalid_identity');
  if(r.drives.length&&!r.evidence?.length)throw Error('evidence_required');
  for(const e of r.evidence||[])if((!['www.mlit.go.jp','www.honda.co.jp','www.bmw.co.jp','web.citroen.jp','www.renault.jp','www.mitsubishi-motors.co.jp','u-catch.daihatsu.co.jp','www.suzuki.co.jp','aftersales.fiat.com','web.peugeot.co.jp','files.alpina.co.jp','www.media.stellantis.com','www.cev-pc.or.jp','www.press.bmwgroup.com','www.lamborghini.com'].includes(new URL(e.url).hostname)&&!(e.sourceType==='manufacturer'&&e.statement&&reviewedFactoryArchives.has(e.url)))||!e.sheet||!Number.isInteger(e.row)||!/^[a-f0-9]{64}$/.test(e.sha256))throw Error('invalid_evidence');
 }
 const key=`${ROOT}/chassis-drive/revisions/${p.sha256}.json`;
 if(!dryRun){
  const prior=await store.readJson(key,null);
  if(prior===null)await store.writeJson(key,rows,{ifNoneMatch:'*'});
  else if(digest(prior)!==p.sha256)throw Error('existing_part_mismatch');
  if(digest(await store.readJson(key,null))!==p.sha256)throw Error('readback_mismatch');
 }
 parts.push({...p,key});
}
const reference={...manifest,parts};
if(!dryRun)await mutateDataJson(`${ROOT}/chassis-drive/current.json`,null,previous=>({...reference,previousDigest:previous?digest(previous):null}));
console.log(JSON.stringify({dryRun,groups:manifest.groups,confirmed:manifest.confirmed,ambiguous:manifest.ambiguous,unresolved:manifest.unresolved,parts:parts.length,digest:digest(reference)}));
