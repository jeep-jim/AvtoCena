import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
export const MARKETS=['china','korea','uae','europe','georgia'];
export const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const sourceHash=text=>createHash('sha256').update(text).digest('hex');
const ok=(value,code)=>assert.ok(value,'candidate_working_set_'+code);
export function inspectCachePolicy(source,expectedSha256){
 ok(/^[a-f0-9]{64}$/.test(expectedSha256||'')&&sourceHash(source)===expectedSha256,'source_pin');
 const matches=[...source.matchAll(/const\s+preparedSelectionCache\s*=\s*new DetailReadCache<BudgetCountIndex>\(\{([^{};]+)\}\);/g)];ok(matches.length===1,'unknown_policy');
 const entries=matches[0][1].split(',').map(x=>x.trim().split(':').map(v=>v.trim()));ok(entries.every(x=>x.length===2)&&new Set(entries.map(x=>x[0])).size===entries.length,'unknown_policy');
 const fields=Object.fromEntries(entries);assert.deepEqual(Object.keys(fields).sort(),['concurrency','maxBytes','maxEntries','sizeOf','ttlMs']);ok(fields.sizeOf==='budgetIndexBytes','size_function');
 const product=text=>{ok(/^\d[\d_]*(?:\s*\*\s*\d[\d_]*)*$/.test(text||''),'unknown_policy');const n=text.split('*').reduce((a,b)=>a*Number(b.trim().replaceAll('_','')),1);ok(Number.isSafeInteger(n)&&n>0,'policy_value');return n;};
 const policy=Object.fromEntries(['concurrency','maxBytes','maxEntries','ttlMs'].map(k=>[k,product(fields[k])]));ok(policy.maxEntries>=MARKETS.length&&policy.maxBytes<=1024**3&&policy.maxBytes>=1024**2,'policy_bounds');
 return {...policy,sizeOf:'budgetIndexBytes',sourceSha256:expectedSha256};
}
export async function indexDigest(index){
 const h=createHash('sha256');h.update('{');let first=true;
 for(const key of Object.keys(index).sort()){
  if(!first)h.update(',');first=false;h.update(JSON.stringify(key)+':');
  if(key==='rows'||key==='otherRows'){ok(Array.isArray(index[key]),'index_rows');h.update('[');for(let i=0;i<index[key].length;i++){if(i)h.update(',');h.update(JSON.stringify(index[key][i]));if(i%256===255)await new Promise(r=>setImmediate(r));}h.update(']');}
  else h.update(JSON.stringify(index[key]));
 }return h.update('}').digest('hex');
}
export function assertWorkingSetProof(proof,context,pins,expected){
 const {checksum,...body}=proof||{};ok(checksum===hash(body),'proof_hash');ok(proof.version===1&&proof.verified===true,'proof');
 assert.equal(proof.contextSha256,hash(context),'candidate_working_set_context');assert.equal(proof.sourcePinsSha256,hash(pins),'candidate_working_set_source_pin');
 assert.deepEqual(Object.keys(proof.markets).sort(),MARKETS.slice().sort(),'candidate_working_set_missing_market');
 ok(Object.values(pins).includes(proof.policy.sourceSha256),'source_pin');
 assert.equal(proof.totalBytes,Object.values(proof.markets).reduce((sum,m)=>sum+m.bytes,0),'candidate_working_set_totals');
 assert.equal(proof.bindingSha256,hash({policy:proof.policy,markets:proof.markets,totalBytes:proof.totalBytes,reads:proof.reads}),'candidate_working_set_binding_hash');
 ok(proof.totalBytes<=proof.policy.maxBytes&&proof.secondCycleReads===0,'capacity');
 if(expected){assertWorkingSetProof(expected,context,pins);assert.equal(proof.bindingSha256,expected.bindingSha256,'candidate_working_set_binding_changed');}
 return proof;
}
export async function measureWorkingSet({context,pins,policy,fingerprints,readIndex,sizeOf,reset,readCount,readSet,assertAuthority}){
 ok(context?.manifest?.generationId&&/^[a-f0-9]{40}$/.test(context.release||'')&&/^[a-f0-9]{64}$/.test(context.calculationVersion||''),'context');
 assert.deepEqual(Object.keys(fingerprints).sort(),MARKETS.slice().sort(),'candidate_working_set_missing_market');
 ok(MARKETS.every(m=>/^[a-f0-9]{64}$/.test(fingerprints[m])),'fingerprint');
 await assertAuthority();await reset();const refs=new Map(),records={};let totalBytes=0;
 for(const market of MARKETS){
  await assertAuthority();const n=readCount(),index=await readIndex(market,fingerprints[market]);
  ok(index&&index.version===3&&index.generationId===context.manifest.generationId,'generation_or_missing_market');
  ok(Array.isArray(index.rows)&&Array.isArray(index.otherRows)&&index.sourceRows===index.rows.length+index.otherRows.length,'index');
  ok(index.rows.every(r=>r[0]===market)&&index.otherRows.every(r=>r[0]===market),'market_rows');
  const bytes=await sizeOf(index);ok(Number.isSafeInteger(bytes)&&bytes>0&&bytes<=policy.maxBytes,'overcap');
  totalBytes+=bytes;ok(totalBytes<=policy.maxBytes,'overcap');ok(readCount()>n,'cold_read_missing');
  refs.set(market,index);records[market]={bytes,rows:index.sourceRows,indexSha256:await indexDigest(index),fingerprint:fingerprints[market]};
 }
 const firstReads=readCount();
 for(const market of MARKETS){const index=await readIndex(market,fingerprints[market]);ok(index===refs.get(market),'cache_identity');assert.equal(await indexDigest(index),records[market].indexSha256,'candidate_working_set_index_changed');}
 const secondCycleReads=readCount()-firstReads;ok(secondCycleReads===0,'cache_reloaded');await assertAuthority();
 const reads=readSet();ok(reads.length>0&&reads.every(r=>r.key.startsWith('catalog/runtime-budget-selections-v1/')&&/^[a-f0-9]{64}$/.test(r.sha256)),'read_set');
 const binding={policy,markets:records,totalBytes,reads};
 const body={version:1,verified:true,contextSha256:hash(context),sourcePinsSha256:hash(pins),...binding,firstCycleReads:firstReads,secondCycleReads,bindingSha256:hash(binding)};
 return {...body,checksum:hash(body)};
}
