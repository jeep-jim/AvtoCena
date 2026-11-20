/** A single native FX observation belongs to this independently authenticated job.
 * The same-run resume digest must come from its pinned runner state, never the receipt file.
 * A portable inventory v2 cut does NOT confer price or publication authority. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
const sha=x=>createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
const shaRE=/^[a-f0-9]{64}$/, cap=64*1024, tokens=new WeakMap();
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function identity(v){
 assert(v?.repository==='jeep-jim/AvtoCena'&&v.workflow==='china-full-fresh-prepare-v1.yml'&&v.job==='prepare'&&v.sourceMode==='complete-fresh-replacement'&&v.attempt==='1'&&/^\d{1,20}$/.test(v.runId||'')&&/^[1-9]\d{0,5}$/.test(v.attempt||'')&&/^[a-f0-9]{40}$/.test(v.headSha||'')&&shaRE.test(v.freshReplacementProofSha256||'')&&shaRE.test(v.archiveReportSha256||''),'china_fx_owner');
 return Object.freeze({repository:v.repository,workflow:v.workflow,runId:v.runId,attempt:v.attempt,headSha:v.headSha,job:v.job,sourceMode:v.sourceMode,freshReplacementProofSha256:v.freshReplacementProofSha256,archiveReportSha256:v.archiveReportSha256});
}
function observationOwner(v,owner){assert(same(v,owner),'china_fx_owner_changed');}
function currencyPlan(plan){
 assert(plan&&typeof plan==='object'&&!Array.isArray(plan)&&Object.hasOwn(plan,'china'),'china_fx_currency_plan');
 const markets=Object.keys(plan).sort();assert(markets.length===1&&markets[0]==='china'&&same(plan.china,['CNY']),'china_fx_currency_plan');
 return Object.fromEntries(markets.map(m=>{const a=plan[m];assert(Array.isArray(a)&&a.length<=12&&a.every(c=>typeof c==='string'&&/^[A-Z]{3}$/.test(c)),'china_fx_currency_plan');return[m,[...new Set(a)].sort()];}));
}
async function fileAt(dir){
 assert(path.isAbsolute(dir)&&await fs.realpath(dir)===dir,'china_fx_directory');
 const s=await fs.stat(dir);assert(s.isDirectory()&&(s.mode&0o077)===0,'china_fx_directory');
 return path.join(dir,'china-frozen-price-observation.json');
}
function verified(native,wire,plan){
 assert(typeof native?.importCatalogFxBatch==='function'&&typeof native?.withCatalogFxBatch==='function','china_fx_native_api');
 assert(wire&&same(Object.keys(wire).sort(),Object.keys(plan).sort()),'china_fx_batch_coverage');
 const result={};let common,snapshot=new Map();
 for(const market of Object.keys(plan)){
  const b=wire[market],entry=native.importCatalogFxBatch(b,b.receiptSha256),r=entry.receipt;
  assert(r.market===market&&plan[market].every(c=>Object.hasOwn(r.rates,c)),'china_fx_batch_coverage');
  const context=[r.runId,r.pricingAsOf,r.observedAt];if(!common)common=context;assert(same(common,context),'china_fx_batch_not_single_observation');
  for(const [code,quote] of Object.entries(r.rates)){if(snapshot.has(code))assert(same(snapshot.get(code),quote),'china_fx_batch_quotes_differ');else snapshot.set(code,quote);}
  result[market]=entry;
 }
 return Object.freeze(result);
}
function mint(native,plan,owner,wire,file,digest){const token=Object.freeze({});tokens.set(token,{native,plan,owner,wire:structuredClone(wire),file,digest,batches:verified(native,wire,plan)});return token;}
async function read(file,digest){
 assert(shaRE.test(digest||''),'china_fx_external_digest_required');
 const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const s=await handle.stat();assert(s.isFile()&&s.nlink===1&&(s.mode&0o077)===0&&s.size>0&&s.size<=cap,'china_fx_bad_file');
  const data=Buffer.alloc(s.size);const {bytesRead}=await handle.read(data,0,data.length,0);
  assert(bytesRead===s.size&&(await handle.stat()).size===s.size&&sha(data)===digest,'china_fx_readback');return JSON.parse(data.toString());
 }finally{await handle.close();}
}
export async function captureChinaPriceObservation({native,owner,plan,directory,assertRunAuthority}){
 assert(typeof assertRunAuthority==='function'&&typeof native?.captureCatalogFxBatches==='function','china_fx_native_api');
 owner=identity(owner);plan=currencyPlan(plan);await assertRunAuthority(owner);
 const file=await fileAt(directory);
 const h=await fs.open(file,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600); // no double observation on duplicate start
 let out;
 try{
  const wire=await native.captureCatalogFxBatches(plan);await assertRunAuthority(owner);verified(native,wire,plan);
  const data=Buffer.from(JSON.stringify({version:1,owner,plan,wire}));assert(data.length<=cap,'china_fx_file_too_large');
  const digest=sha(data);await h.writeFile(data);await h.sync();out={wire,digest};
 }finally{await h.close();}
 await read(file,out.digest);await assertRunAuthority(owner);
 return Object.freeze({authority:mint(native,plan,owner,out.wire,file,out.digest),observationSha256:out.digest});
}
export async function reopenChinaPriceObservation({native,owner,plan,directory,observationSha256,assertRunAuthority}){
 assert(typeof assertRunAuthority==='function','china_fx_run_authority');
 owner=identity(owner);plan=currencyPlan(plan);await assertRunAuthority(owner);
 const file=await fileAt(directory),v=await read(file,observationSha256);observationOwner(v.owner,owner);
 assert(v.version===1&&same(v.plan,plan),'china_fx_plan_changed');await assertRunAuthority(owner);
 return mint(native,plan,owner,v.wire,file,observationSha256);
}
export function createChinaPriceHandoff(authority){
 const x=tokens.get(authority);assert(x,'china_fx_capability');
 return Object.freeze({
  // Each separate TS module realm imports from authorized wire before ALS use.
  // A child receives its externally pinned digest separately, not from input JSON.
  withMarket(market,fn){assert(Object.hasOwn(x.batches,market)&&typeof fn==='function','china_fx_market');return x.native.withCatalogFxBatch(x.batches[market],fn);},
  stagedInput(){return{wire:structuredClone(x.wire),plan:structuredClone(x.plan),transportSha256:sha(x.wire),observationSha256:x.digest};},
  async assertBeforeSwitch({assertRunAuthority,verifyStagedCurrent,assertLegalCurrent}){
   assert([assertRunAuthority,verifyStagedCurrent,assertLegalCurrent].every(f=>typeof f==='function'),'china_fx_publication_gates');
   await assertRunAuthority(x.owner);const v=await read(x.file,x.digest);observationOwner(v.owner,x.owner);assert(same(v.plan,x.plan)&&same(v.wire,x.wire),'china_fx_readback');
   // The caller must supply trusted native stage verification and separate actual legal horizon checks.
   // Never use the FX observation date or a blanket UTC-midnight deadline as authority here.
   const receipts=Object.fromEntries(Object.entries(x.batches).map(([m,b])=>[m,b.receiptSha256]));
   const report=await verifyStagedCurrent({observationSha256:x.digest,receipts});
   const observed=report?.fxEvidence?.receiptDigests;
   assert(report?.verified===true&&observed&&same(Object.entries(observed).sort(),Object.entries(receipts).sort()),'china_fx_staged_receipt_mismatch');
   await assertLegalCurrent(report);await assertRunAuthority(x.owner);
  }
 });
}
