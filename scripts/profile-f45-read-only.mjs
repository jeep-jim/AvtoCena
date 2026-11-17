import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import {syncBuiltinESMExports} from 'node:module';

const SHA='f45efaf2b172af41d14987fb642e8e6b6df78cdd';
const PREFIX='/avtocena-staging-8120751/migration-staging/full-20261011/';
const mutations=['writeJson','deleteJson','putBinary','deleteBinary','deleteObjects','deletePrefix'];
let forbidden=0;
const deny=()=>{forbidden++;throw Error('diagnostic_operation_forbidden');};
function guardedFetch(original){return (input,init)=>{
 const method=String(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
 const url=new URL(input instanceof Request?input.url:String(input));
 if(!['GET','HEAD'].includes(method)||url.origin!=='https://s3.regru.cloud'||!decodeURIComponent(url.pathname).startsWith(PREFIX)||url.search||url.username||url.password)return deny();
 return original(input,{...init,redirect:'error'});
};}
function lockStorage(storage){for(const name of mutations)Object.defineProperty(storage,name,{value:async()=>deny(),writable:false,configurable:false});}
function installNetworkGuard(){
 globalThis.fetch=guardedFetch(globalThis.fetch.bind(globalThis));
 // Imports must not use native HTTP as a route around the fetch guard.
 for(const transport of [http,https]){transport.request=deny;transport.get=deny;}
 syncBuiltinESMExports();
}
function ensureClean(){assert.equal(forbidden,0,'a forbidden operation was attempted, even if application code caught it');}
async function selfTest(){
 let calls=0;const fake=guardedFetch(async(input,init)=>{calls++;assert.equal(init.redirect,'error');return 'ok'});
 const u='https://s3.regru.cloud'+PREFIX+'dealers/dealers.json';
 assert.equal(await fake(u),'ok');assert.equal(await fake(u,{method:'HEAD'}),'ok');
 for(const method of ['PUT','POST','PATCH','DELETE'])assert.throws(()=>fake(u,{method}));
 assert.throws(()=>fake(new Request(u,{method:'POST'})));
 for(const bad of ['https://jq.profinance.ru/html/htmlquotes/site.jsp','https://s3.regru.cloud/other/key',u+'?delete','http://s3.regru.cloud'+PREFIX+'x'])assert.throws(()=>fake(bad));
 assert.equal(calls,2);
 const s={};lockStorage(s);for(const name of mutations)await assert.rejects(s[name]());
 assert.throws(ensureClean);console.log('READ_ONLY_GUARD_SELF_TEST passed: method, host, prefix, query, redirect policy, all storage mutations, swallowed attempt detection');
}
async function setup(){
 assert.equal(process.env.JSON_STORAGE_DRIVER,'object');
 assert.equal(process.env.YC_OBJECT_STORAGE_ENDPOINT,'https://s3.regru.cloud');
 assert.equal(process.env.YC_OBJECT_STORAGE_BUCKET,'avtocena-staging-8120751');
 assert.equal(process.env.YC_OBJECT_STORAGE_PREFIX,'migration-staging/full-20261011/');
 const head=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'});assert.equal(head.status,0);assert.equal(head.stdout.trim(),SHA);
 installNetworkGuard(); // Before any application imports or initialization.
 const {getJsonStorage}=await import('../apps/web/lib/data.ts');
 const storage=getJsonStorage();assert.equal(storage.driver,'object');lockStorage(storage);
 const reads=[];const original=storage.readJsonWithMeta.bind(storage);
 storage.readJsonWithMeta=async(...args)=>{const t=performance.now();try{return await original(...args);}finally{reads.push({keyHash:createHash('sha256').update(String(args[0])).digest('hex'),ms:+(performance.now()-t).toFixed(2)});}};
 return reads;
}
async function login(mode){
 const reads=await setup();
 const {readPublicFeatures,readShowcase,findDealer}=await import('../apps/web/lib/dealers/showcase-store.ts');
 const {availableShowcase}=await import('../apps/web/lib/dealers/program-store.ts');
 const {withDealerRate}=await import('../apps/web/lib/dealers/exchange-rate.ts');
 const {publicDealerProfile}=await import('../apps/web/lib/dealers/public-profile.ts');
 const {publicRail}=await import('../apps/web/lib/dealers/public-rail.ts');
 const {PILOT_DEALER_ID}=await import('../apps/web/lib/dealers/showcase-model.ts');
 // Source drift must fail before measurements; exact pre-patch semantics below.
 const source=readFileSync('apps/web/app/(public)/login/page.tsx','utf8');
 assert.ok(source.includes('const features = await readPublicFeatures();\n  const stored = await readShowcase(PILOT_DEALER_ID);'));
 const reports=[];const began=performance.now();
 for(const [phase,wait] of [['initial',0],['warm',0],['after35s',35000],['afterAdditional65s',65000]]){
  if(wait)await new Promise(r=>setTimeout(r,wait));
  reads.length=0;const stages={};const start=performance.now();
  const measure=async(name,fn)=>{const t=performance.now();try{return await fn();}finally{stages[name]=+(performance.now()-t).toFixed(2);}};
  let features,stored;
  if(mode==='sequential'){
   features=await measure('features',()=>readPublicFeatures());stored=await measure('showcase',()=>readShowcase(PILOT_DEALER_ID));
  }else{
   const featuresPromise=measure('features',()=>readPublicFeatures());
   const storedResultPromise=measure('showcase',()=>readShowcase(PILOT_DEALER_ID)).then(value=>({ok:true,value}),error=>({ok:false,error}));
   features=await featuresPromise;const result=await storedResultPromise;if(!result.ok)throw result.error;stored=result.value;
  }
  // Same order and admission semantics as exact f45, including disabled result.
  const dealer=stored?.profileEnabled?await measure('quotesAndSavedRate',async()=>withDealerRate(await measure('available',()=>availableShowcase(stored)))):null;
  const topDealer=dealer?.profileEnabled?{profile:publicDealerProfile(dealer),items:publicRail(dealer),verified:(await measure('verification',()=>findDealer(PILOT_DEALER_ID)))?.status==='verified'}:undefined;
  ensureClean();
  const report={mode,phase,totalMs:+(performance.now()-start).toFixed(2),elapsedMs:+(performance.now()-began).toFixed(2),stages,readCount:reads.length,reads:[...reads],offers:topDealer?.items.length||0,featureVersion:features.version,quoteErrors:dealer?.offers.filter(o=>o.availability==='market'&&o.marketQuote?.error).length||0,outputDigest:createHash('sha256').update(JSON.stringify({features,topDealer},function(key,value){return key==='marketQuote'&&value?Object.fromEntries(Object.entries(value).filter(([field])=>field!=='at')):value;})).digest('hex')};
  reports.push(report);console.log('LOGIN_READ_PROFILE',JSON.stringify(report));
 }
 console.log('WORKER_REPORT',JSON.stringify(reports));
}
async function china(){
 const reads=await setup();
 const {readPreparedBudgetSelection}=await import('../apps/web/lib/catalog/shared-budget-prices.ts');
 const {budgetIndexBytes}=await import('../apps/web/lib/catalog/budget-row-size.ts');
 let previous;const reports=[];
 for(let sample=1;sample<=2;sample++){
  reads.length=0;const t=performance.now();
  const index=await readPreparedBudgetSelection('gen_1794878284419_a611dfcf','china','b62c41f89c6b7e81664627e5e5a2688e159f9ab5b97918fcf4940333c1d1ff13');
  const ms=+(performance.now()-t).toFixed(2),readCount=reads.length;ensureClean();assert.ok(index,'fixed prepared selection missing or incompatible; do not regenerate');
  const bytes=await budgetIndexBytes(index);ensureClean();
  const report={sample,ms,readCount,referenceEqualityWithPrevious:sample===2?index===previous:null,budgetIndexBytes:bytes,preparedCacheLimitBytes:64*1024*1024,exceedsPreparedCacheLimit:bytes>64*1024*1024,rows:index.rows.length};
  reports.push(report);console.log('CHINA_PREPARED_READ',JSON.stringify(report));previous=index;
 }
 ensureClean();
}
async function compare(){
 const reports=[];
 // Fresh processes prevent one variant from warming the other's caches.
 // ABBA also exposes order/network variability; no production request is made.
 for(const mode of ['sequential','parallel','parallel','sequential']){
  const p=spawnSync(process.execPath,['--import','tsx',process.argv[1],'--worker',mode],{encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024});
  if(p.status!==0){console.error('PROFILE_WORKER_FAILED',JSON.stringify({mode,status:p.status,signal:p.signal}));process.exitCode=1;return;}
  const line=p.stdout.split('\n').find(x=>x.startsWith('WORKER_REPORT '));assert.ok(line);
  const rows=JSON.parse(line.slice('WORKER_REPORT '.length));reports.push({mode,rows});
  for(const r of rows)console.log('LOGIN_READ_PROFILE',JSON.stringify(r));
 }
 const digests=new Set(reports.flatMap(r=>r.rows.map(x=>x.outputDigest)));
 console.log('PROFILE_COMPARISON',JSON.stringify({source:SHA,allOutputDigestsEqual:digests.size===1,readOnly:true,runnerNotServingProcess:true,reactRequestMemoizationNotSimulated:true,notAcceptanceEvidence:true,digestExcludesOnlyMarketQuoteCalculationTimestamp:true}));
 // A changed saved object can also produce unequal output. Flag, never hide it.
 assert.equal(digests.size,1,'outputs differ: inspect saved-data changes or semantic mismatch before interpreting timing');
}
try{
 if(process.argv[2]==='--self-test')await selfTest();
 else if(process.argv[2]==='--worker'){assert.ok(['sequential','parallel'].includes(process.argv[3]));await login(process.argv[3]);}
 else if(process.argv[2]==='--china')await china();
 else if(process.argv[2]==='--compare')await compare();
 else throw Error('explicit diagnostic mode required');
}catch{console.error('READ_ONLY_DIAGNOSTIC_FAILED',{forbiddenAttempts:forbidden});process.exitCode=1;}
