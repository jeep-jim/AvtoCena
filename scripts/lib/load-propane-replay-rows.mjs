import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const ROOT='catalog/intake-staging/encar/43989797288/1',CONTROLS='catalog/operations/collection-controls-v1.json',SNAPSHOT='c34e0546b1214a3829b7b6317f87c2ff3be05ff8bc9cd7c0ec5db0e212b7ac43',PRODUCER='e51f589f892babdcd6c1251e1ebb06c6d7c91e6d';
import {validatePropaneManifest} from './propane-replay-contract.mjs';
function entries(manifest){validatePropaneManifest(manifest);return manifest.entries;}
export function allowedActualFullpricePaths(manifest){const keys=new Set([ROOT+'/complete.json',CONTROLS]);for(const {coordinate:{page}} of entries(manifest)){keys.add(ROOT+'/pages/'+page+'.json');for(const n of [page-1,page,page+1])if(n>=1&&n<=10198)keys.add(ROOT+'/page-receipts/'+n+'.json');}return keys;}
export function verifyActualFullpricePage({snapshot,page,rows,receipt,previous,next}){
 assert.ok(Array.isArray(rows)&&rows.length>0&&rows.length<=20);assert.equal(rows.length,receipt.count);assert.equal(hash(rows),receipt.sha256);
 for(const [n,r] of [[page,receipt],...(previous?[[page-1,previous]]:[]),...(next?[[page+1,next]]:[])]){assert.ok(r);for(const k of ['version','market','provider','runId','attempt','producerSha'])assert.equal(r[k],snapshot[k]);assert.equal(r.page,n);assert.equal(r.next,n<snapshot.pages?n+1:null);}
 if(page>1){assert.ok(previous);assert.equal(receipt.previousSha256,hash(previous));assert.equal(receipt.totalCount,previous.totalCount+receipt.count);}else{assert.equal(receipt.previousSha256,null);assert.equal(receipt.totalCount,receipt.count);}
 if(page<snapshot.pages){assert.ok(next);assert.equal(next.previousSha256,hash(receipt));assert.equal(next.totalCount,receipt.totalCount+next.count);}
}
/** Raw envelopes remain private to caller; no output serialization or writes.
 * Bounded coordinate proof only, NOT full-source selection/retirement proof. */
export async function loadActualFullpriceRows({storage,manifest,controlsEnabled,admit}){
 const wanted=entries(manifest),allow=allowedActualFullpricePaths(manifest);assert.equal(typeof controlsEnabled,'function');assert.equal(typeof admit,'function');
 const read=key=>{assert.ok(allow.has(key),'fullprice_read_scope');return storage.readJson(key,null);};
 const snapshot=await read(ROOT+'/complete.json');assert.equal(hash(snapshot),SNAPSHOT);assert.equal(snapshot.producerSha,PRODUCER);assert.equal(snapshot.runId,'43989797288');assert.equal(snapshot.attempt,'1');assert.equal(snapshot.count,203948);assert.equal(snapshot.pages,10198);
 const initial=await read(CONTROLS);assert.ok(controlsEnabled(initial));const authority=structuredClone({market:initial.markets.korea,source:initial.sources.encar_feed});
 const checkControls=async()=>{const c=await read(CONTROLS);assert.ok(controlsEnabled(c));assert.deepEqual({market:c.markets.korea,source:c.sources.encar_feed},authority);};
 const receipts=new Map();async function receipt(n){if(!receipts.has(n))receipts.set(n,await read(ROOT+'/page-receipts/'+n+'.json'));return receipts.get(n);}
 const rows=[],pages=[...new Set(wanted.map(e=>e.coordinate.page))].sort((a,b)=>a-b);
 for(const page of pages){await checkControls();const data=await read(ROOT+'/pages/'+page+'.json'),r=await receipt(page),previous=page>1?await receipt(page-1):null,next=page<snapshot.pages?await receipt(page+1):null;verifyActualFullpricePage({snapshot,page,rows:data,receipt:r,previous,next});
  for(const e of wanted.filter(e=>e.coordinate.page===page)){const raw=data[e.coordinate.row-1];assert.ok(raw);assert.equal(hash(raw),e.rawSha256,'fullprice_raw_changed');const id=String(raw.inner_id);assert.match(id,/^\d{6,10}$/);assert.equal(String(raw.data?.inner_id),id);assert.equal(hash(id),e.identitySha256,'fullprice_identity_changed');assert.equal(await admit(raw.data),true,'fullprice_sample_no_longer_admitted');rows.push({raw,coordinate:{...e.coordinate},observedAt:snapshot.completedAt});}
 }
 assert.equal(rows.length,wanted.length);const verify=async()=>{await checkControls();assert.equal(hash(await read(ROOT+'/complete.json')),SNAPSHOT,'fullprice_snapshot_changed');};await verify();
 return {rows,verify,checks:{pageHashes:true,adjacentReceiptLinks:true,rawHashes:true,identityHashes:true,admitted:true,controlsUnchanged:true,snapshotUnchanged:true,fullReceiptChain:false,selectionResolutionPerformed:false,publicationAcceptance:false,pages:pages.length,rows:rows.length}};
}
