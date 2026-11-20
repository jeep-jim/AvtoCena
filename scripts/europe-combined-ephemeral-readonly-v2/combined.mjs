import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspect,narrowReader} from './signed-inline-probe.mjs';

const A='autoscout_europe_open', M='mobile_de_open';
const hash=()=>createHash('sha256');
const sha=x=>hash().update(x).digest('hex');
const req=(x,error)=>assert.ok(x,error);
const add=(h,x)=>h.update(JSON.stringify(x)+'\n');
const approved=Object.freeze({
 sourceRun:44765774453,siblingRun:44769053821,gen:'gen_1794878284419_a611dfcf',
 immutableRootWireSha:'80942ea4323937871366c2fa909a92cf1e6a1e7a5d2a402ddf093088853dde85',
 immutableRootEtagSha:'bb7499e3525e15a2f02f23d9222693c6462873a679089551d57e646daea5489b',
 mobile:{count:32151,orderedIdsSha:'2efb6e072ba678fda299ee73091832c55e39682bcdf7094b6156304cc8062836',orderedProjectionRowsSha:'4d9ce220015f271f4b4b8efaaa991fc13b56fe2b2ca87dcb12158a0b57824f64'},
 scout:{count:6813,orderedIdsSha:'6bae38c8a6e413121f5abb2b59a84fb74f0226fbafb8d4f900d1457b2bc9c0c4',orderedProjectionRowsSha:'195503f336eea9523fb4639a42264ac1034efd1e16f17117e58f37640c0ee2a5'},
 runtime:'22867cbcfaee27b2e8917b6bf880e44827f67b60',calc:'4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90',
 from:'2026-11-20T00:00:00Z',until:'2026-11-21T00:00:00Z',archiveAt:'2026-11-19T23:34:26.268Z',rate:89.8597,
 archiveManifestSha:'2294967a5d0b1593d9587137bdb8cb2959e335d1ff7f6b442ba283544ab7f62d',fxSha:'2adeb25ad182398684c4c646e110ded5449f7174e4a4442f8bff6b7d1d32aec6',
 admitted:1510,admittedIdsSha:'2cb5f096f56c0d7bc04041b8b3edc047509052122efac785d8151750c747f6ff',
 admittedTypedRowsSha:'e35d54a204d9f4ad3bc88065c1dcd57fabe5d9811aae3f59e3daaec514f41b3a',
 admittedCompactArraySha:'f94232b49867702826dccaf290ba0cc675e5d47f8d1fde7f9273d178861b626a',
});
const fresh=(time,p=approved)=>Number.isSafeInteger(time)&&time>=Date.parse(p.from)&&time<Date.parse(p.until)&&
 time>=Date.parse(p.archiveAt)&&time-Date.parse(p.archiveAt)<72*3600000;
const same=(actual,pin)=>actual?.count===pin.count&&actual.orderedIdsSha===pin.orderedIdsSha&&actual.orderedProjectionRowsSha===pin.orderedProjectionRowsSha;

function validateStatic(){
 const digests=[approved.immutableRootWireSha,approved.immutableRootEtagSha,approved.mobile.orderedIdsSha,approved.mobile.orderedProjectionRowsSha,
  approved.scout.orderedIdsSha,approved.scout.orderedProjectionRowsSha,approved.archiveManifestSha,approved.fxSha,
  approved.admittedIdsSha,approved.admittedTypedRowsSha,approved.admittedCompactArraySha,approved.calc];
 req(digests.every(h=>typeof h==='string'&&/^[0-9a-f]{64}$/.test(h)),'static_sha256_pin_invalid');
}
function verifySignedProof(proof,p){
 const e=proof?.evidence;
 req(proof?.pinnedPublicInternalAndRoot===true&&e?.generation===p.gen,'signed_control_commitment_drift');
 req(proof.rootEtagSha256===p.immutableRootEtagSha,'signed_root_etag_drift');
 req(e.wireSha256===p.immutableRootWireSha,'signed_root_bytes_drift');
 req(e.groups&&!e.groups.other_protected,'signed_unknown_source_group');
 req(same(e.groups[M],p.mobile),'signed_mobile_compact_drift');
 req(same(e.groups[A],p.scout),'signed_autoscout_compact_drift');
}
export function verifyPriorSignedFixture(proof){
 validateStatic();
 verifySignedProof(proof,approved);
 return true;
}
function certifyNative(compactBytes,w,p){
 req(w?.installed===p.runtime&&w.calc===p.calc&&w.fxSha===p.fxSha&&w.archiveManifestSha===p.archiveManifestSha&&w.source===A&&w.count===p.admitted&&
     w.admittedIdsSha===p.admittedIdsSha&&w.admittedProjectionRowsSha===p.admittedTypedRowsSha&&w.deliveredPricesApproved===0&&w.privateOnly===true&&w.publicationAuthorized===false&&
     w.network?.outgoingNetworkAttempts===0,'exact_native_witness_missing');
 req(Buffer.isBuffer(compactBytes)&&compactBytes.length>0&&compactBytes.length<=16*1024**2&&sha(compactBytes)===p.admittedCompactArraySha,'native_compact_wire_drift');
 const rows=JSON.parse(compactBytes), ids=new Set(), typed=hash();
 req(Array.isArray(rows)&&rows.length===p.admitted,'native_compact_count_drift');
 for(const row of rows){
   req(typeof row?.id==='string'&&row.id.length>0&&row.id.length<=128&&!ids.has(row.id)&&row.market==='europe'&&row.sourceGroup===A&&
    row.catalogPricingMode==='seller'&&row.sourceCurrency==='EUR'&&Number.isFinite(row.sourcePrice)&&row.sourcePrice>0&&
    row.sellerPriceRub===Math.round(row.sourcePrice*p.rate)&&row.totalRub===null&&(row.publicVisibleRub??0)===0,'native_compact_not_seller_only');
   ids.add(row.id);add(typed,row);
 }
 req(sha(JSON.stringify([...ids]))===p.admittedIdsSha&&typed.digest('hex')===p.admittedTypedRowsSha,'native_compact_typed_drift');
 return {rows,ids};
}

async function simulate({compactBytes,witness,runSigned,clock},p){
 req(fresh(clock(),p),'current_cbr_or_source_authority_expired');
 const {rows,ids}=certifyNative(compactBytes,witness,p);
 const overlap=new Set(), targetIds=hash(),targetRows=hash(),suffixIds=hash(),suffixRows=hash();
 let observed=0,oldTarget=0;
 const proof=await runSigned(row=>{
  observed++;
  if(row.sourceGroup!==A){req(!ids.has(row.id),'archived_id_collides_other_source');return;}
  oldTarget++;
  if(ids.has(row.id))overlap.add(row.id);
  add(targetIds,row.id);add(targetRows,row);
 });
 verifySignedProof(proof,p);
 req(observed===p.mobile.count+p.scout.count&&oldTarget===p.scout.count,'signed_observer_count_drift');
 req(fresh(clock(),p),'pricing_or_source_expired_during_dry_run');
 let added=0;
 for(const row of rows){if(overlap.has(row.id))continue;add(targetIds,row.id);add(targetRows,row);add(suffixIds,row.id);add(suffixRows,row);added++;}
 req(added+overlap.size===p.admitted,'archive_overlap_reconciliation_failed');
 return {mode:'ephemeral_europe_source_compact_dry_only',intake:p.sourceRun,liveWitness:p.siblingRun,generation:p.gen,
   archivedNativeLeads:p.admitted,publicOverlapPreserved:overlap.size,sourceAdditions:added,
   protectedMobile:{...p.mobile},retainedAutoScout:{...p.scout},
   stagedAutoScout:{count:oldTarget+added,orderedIdsSha:targetIds.digest('hex'),orderedProjectionRowsSha:targetRows.digest('hex')},
   addedAutoScout:{count:added,orderedIdsSha:suffixIds.digest('hex'),orderedProjectionRowsSha:suffixRows.digest('hex')},
   fullCardPayloadReconciliation:false,internalSettlementProven:false,readyToActivate:false,
   projectionArtifactWritten:false,providerCalls:0,storageWrites:0,reads:proof.reads};
}
export function rehearse(input,p){return simulate(input,p);}
async function local(file,cap){
 const s=await fs.lstat(file);
 req(s.isFile()&&(s.mode&0o077)===0&&s.size>0&&s.size<=cap,'input_not_private_or_bounded');
 const body=await fs.readFile(file);req(body.length===s.size,'local_input_changed');
 return body;
}
async function assertServingContext(){
 const r=await fetch('https://avtocena.com/api/health',{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(6000)});
 req(r.status===200,'serving_health_unavailable');
 let total=0;const chunks=[];
 for await(const block of r.body){total+=block.byteLength;req(total<=16*1024,'serving_health_bound');chunks.push(block);}
 const h=JSON.parse(Buffer.concat(chunks,total));
 req(h.releaseSha===approved.runtime&&h.calculationVersion===approved.calc&&h.catalogProjectionParts==='scoped-v1','serving_runtime_or_calc_changed');
}
export async function verifyNativeInput(dir){
 validateStatic();

 req(fresh(Date.now()),'current_cbr_or_source_authority_expired');
 const s=await fs.lstat(dir);
 req(s.isDirectory()&&(s.mode&0o077)===0,'private_input_dir_required');
 const compactBytes=await local(path.join(dir,'native-compact-admitted.json'),16*1024**2);
 const witness=JSON.parse(await local(path.join(dir,'admission-witness.json'),16*1024));
 certifyNative(compactBytes,witness,approved);
 return {compactBytes,witness};
}
export async function execute(dir,diagnostic={phase:'native_input',publicHealthReads:0}){
 const {compactBytes,witness}=await verifyNativeInput(dir);
 diagnostic.phase='serving_preflight';
 diagnostic.publicHealthReads++;
 await assertServingContext();
 // No reviewed digest may come from the current workflow event or env.
 diagnostic.phase='signed_immutable';
 const reader=narrowReader();
 diagnostic.stats=reader.stats;
 const report=await simulate({compactBytes,witness,clock:Date.now,runSigned:observeRow=>inspect({reader,observeRow})},approved);
 diagnostic.phase='serving_postflight';
 diagnostic.publicHealthReads++;
 await assertServingContext();
 req(fresh(Date.now()),'current_cbr_or_source_authority_expired');
 return {...report,liveServingRuntimeAndCalculationBound:true,publicHealthReads:2};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const diagnostic={phase:'native_input',publicHealthReads:0};
 try{console.log(JSON.stringify(await execute(process.argv[2],diagnostic)));}
 catch(e){const reason=typeof e.message==='string'&&/^[a-z_]{1,100}$/.test(e.message)?e.message:'private_dry_preflight_failed';
 console.error(JSON.stringify({status:'held',phase:diagnostic.phase,reason,reads:diagnostic.stats?.()??{reads:0,controlBytes:0,projectionBytes:0},publicHealthReads:diagnostic.publicHealthReads,readyToActivate:false,storageWrites:0,providerCalls:0}));
 process.exitCode=2;}
}
