import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import {syncBuiltinESMExports} from 'node:module';
import {getHeapStatistics} from 'node:v8';
import {AsyncLocalStorage} from 'node:async_hooks';

const SHA='f45efaf2b172af41d14987fb642e8e6b6df78cdd';
const PREFIX='/avtocena-staging-8120751/migration-staging/full-20261011/';
const mutations=['writeJson','deleteJson','putBinary','deleteBinary','deleteObjects','deletePrefix'];
let forbidden=0,currentStage='startup';
const guardEvents=[];
const stagesContext=new AsyncLocalStorage();
const activeStage=()=>stagesContext.getStore()||currentStage;
let publicCbrReads=0;
const memory=()=>({...process.memoryUsage(),heapSizeLimit:getHeapStatistics().heap_size_limit});
function errorInfo(error){
 const name=['Error','AssertionError','TypeError','RangeError','SyntaxError'].includes(error?.name)?error.name:'OtherError';
 const code=['ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND','ERR_ASSERTION','ERR_INVALID_ARG_TYPE','ERR_UNKNOWN_FILE_EXTENSION'].includes(error?.code)?error.code:'OTHER';
 const prefix=String(error?.message||'').split(':')[0];
 const messageCode=/^(?:diagnostic_|catalog_|object_storage_)[a-z0-9_]{1,70}$/.test(prefix)?prefix:'REDACTED';
 return {stage:activeStage(),name,code,messageCode,forbiddenAttempts:forbidden,publicCbrReads,guardEvents:guardEvents.slice(0,20),memory:memory()};
}
const deny=(reason='unspecified')=>{forbidden++;if(guardEvents.length<20)guardEvents.push({stage:activeStage(),reason});throw Error('diagnostic_operation_forbidden');};
function guardedFetch(original){return (input,init)=>{
 const method=String(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
 const url=new URL(input instanceof Request?input.url:String(input));
 if(!['GET','HEAD'].includes(method))return deny('non_read_method');
 if(url.href==='https://www.cbr.ru/scripts/XML_daily.asp'&&method==='GET'){
  const headers=new Headers(init?.headers||(input instanceof Request?input.headers:undefined));
  if(['authorization','proxy-authorization','cookie'].some(name=>headers.has(name)))return deny('cbr_credentials');
  publicCbrReads++;
  return original(input,{...init,redirect:'error',credentials:'omit'});
 }
 if(url.origin!=='https://s3.regru.cloud')return deny(url.hostname==='www.cbr.ru'?'cbr_endpoint_not_allowed':/(?:^|\.)profinance\.ru$/.test(url.hostname)?'profinance_not_allowed':'external_host');
 if(!decodeURIComponent(url.pathname).startsWith(PREFIX))return deny('outside_storage_prefix');
 if(url.search||url.username||url.password)return deny('query_or_userinfo');
 return original(input,{...init,redirect:'error'});
};}
function lockStorage(storage){for(const name of mutations)Object.defineProperty(storage,name,{value:async()=>deny('storage_'+name),writable:false,configurable:false});}
function installNetworkGuard(){
 globalThis.fetch=guardedFetch(globalThis.fetch.bind(globalThis));
 // Imports must not use native HTTP as a route around the fetch guard.
 for(const transport of [http,https]){transport.request=()=>deny('native_http');transport.get=()=>deny('native_http');}
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
 const cbr='https://www.cbr.ru/scripts/XML_daily.asp';
 assert.equal(await fake(cbr,{method:'GET',redirect:'follow'}),'ok');
 for(const method of ['HEAD','POST','PUT'])assert.throws(()=>fake(cbr,{method}));
 for(const bad of [cbr+'?date_req=17/11/2026',cbr+'#x','https://user:pass@www.cbr.ru/scripts/XML_daily.asp','https://www.cbr.ru/other','http://www.cbr.ru/scripts/XML_daily.asp'])assert.throws(()=>fake(bad));
 for(const name of ['authorization','cookie','proxy-authorization'])assert.throws(()=>fake(cbr,{headers:{[name]:'SECRET'}}));
 assert.equal(calls,3);
 const s={};lockStorage(s);for(const name of mutations)await assert.rejects(s[name]());
 const redacted=JSON.stringify(errorInfo(Object.assign(new Error('SECRET query token'),{code:'SECRET'})));assert.ok(!redacted.includes('SECRET'));assert.ok(guardEvents.some(x=>x.reason==='profinance_not_allowed'));
 assert.throws(ensureClean);console.log('READ_ONLY_GUARD_SELF_TEST passed: method, host, prefix, query, redirect policy, all storage mutations, swallowed attempt detection');
}
async function setup(){
 assert.equal(process.env.JSON_STORAGE_DRIVER,'object');
 assert.equal(process.env.YC_OBJECT_STORAGE_ENDPOINT,'https://s3.regru.cloud');
 assert.equal(process.env.YC_OBJECT_STORAGE_BUCKET,'avtocena-staging-8120751');
 assert.equal(process.env.YC_OBJECT_STORAGE_PREFIX,'migration-staging/full-20261011/');
 const head=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'});assert.equal(head.status,0);assert.equal(head.stdout.trim(),SHA);
 installNetworkGuard(); // Before any application imports or initialization.
 currentStage='import:data';
 const {getJsonStorage}=await import('../apps/web/lib/data.ts');
 const storage=getJsonStorage();assert.equal(storage.driver,'object');lockStorage(storage);
 const reads=[];const original=storage.readJsonWithMeta.bind(storage);
 storage.readJsonWithMeta=async(...args)=>{const t=performance.now();try{return await original(...args);}finally{reads.push({keyHash:createHash('sha256').update(String(args[0])).digest('hex'),ms:+(performance.now()-t).toFixed(2)});}};
 return reads;
}
async function login(mode){
 const reads=await setup();
 currentStage='import:showcase';
 const {readPublicFeatures,readShowcase,findDealer}=await import('../apps/web/lib/dealers/showcase-store.ts');
 currentStage='import:admission';
 const {availableShowcase}=await import('../apps/web/lib/dealers/program-store.ts');
 currentStage='import:rates';
 const {withDealerRate}=await import('../apps/web/lib/dealers/exchange-rate.ts');
 currentStage='import:public-profile';
 const {publicDealerProfile}=await import('../apps/web/lib/dealers/public-profile.ts');
 currentStage='import:public-rail';
 const {publicRail}=await import('../apps/web/lib/dealers/public-rail.ts');
 currentStage='import:model';
 const {PILOT_DEALER_ID}=await import('../apps/web/lib/dealers/showcase-model.ts');
 // Source drift must fail before measurements; exact pre-patch semantics below.
 const source=readFileSync('apps/web/app/(public)/login/page.tsx','utf8');
 assert.ok(source.includes('const features = await readPublicFeatures();\n  const stored = await readShowcase(PILOT_DEALER_ID);'));
 const reports=[];const began=performance.now();
 for(const [phase,wait] of [['initial',0],['warm',0],['after35s',35000],['afterAdditional65s',65000]]){
  if(wait)await new Promise(r=>setTimeout(r,wait));
  reads.length=0;const stages={};const start=performance.now();
  const measure=(name,fn)=>stagesContext.run('login:'+name,async()=>{const t=performance.now();try{return await fn();}catch(error){console.error('DIAGNOSTIC_ERROR',JSON.stringify(errorInfo(error)));throw error;}finally{stages[name]=+(performance.now()-t).toFixed(2);}});
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
  const report={memory:memory(),publicCbrReads,mode,phase,totalMs:+(performance.now()-start).toFixed(2),elapsedMs:+(performance.now()-began).toFixed(2),stages,readCount:reads.length,reads:[...reads],offers:topDealer?.items.length||0,featureVersion:features.version,quoteErrors:dealer?.offers.filter(o=>o.availability==='market'&&o.marketQuote?.error).length||0,outputDigest:createHash('sha256').update(JSON.stringify({features,topDealer},function(key,value){return key==='marketQuote'&&value?Object.fromEntries(Object.entries(value).filter(([field])=>field!=='at')):value;})).digest('hex')};
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

async function allMarkets(){
 const reads=await setup();currentStage='import:prepared';
 const {readPreparedBudgetSelection}=await import('../apps/web/lib/catalog/shared-budget-prices.ts');
 const {budgetIndexBytes}=await import('../apps/web/lib/catalog/budget-row-size.ts');
 const fingerprints={"china": "b62c41f89c6b7e81664627e5e5a2688e159f9ab5b97918fcf4940333c1d1ff13", "korea": "0ce6682a48f9202f2987afe301c112852485aea3ea556d3517641b4676ffcbf7", "uae": "379e45372a3ff343421590a3120bb5a2f145ec72c0456af425af38fb3eb3b8db", "europe": "73afbbd351bc863bf5374910cb6c168f37ab5c98b3f9dd490e1dd31072939685", "georgia": "54084985493abfbc73a9eec1da9931613174ff7f7dd6598d4aab5a3b847ba64d"};
 const generation='gen_1794878284419_a611dfcf';
 const previous=new Map(),sizes=new Map();
 console.log('PREPARED_MEMORY_BEFORE',JSON.stringify(memory()));
 for(let cycle=1;cycle<=2;cycle++)for(const market of ['china','korea','uae','europe','georgia']){
  currentStage='prepared:'+market;reads.length=0;const start=performance.now();
  const index=await readPreparedBudgetSelection(generation,market,fingerprints[market]);
  const ms=+(performance.now()-start).toFixed(2),readCount=reads.length;
  ensureClean();assert.ok(index,'fixed prepared selection unavailable; do not regenerate');
  const bytes=await budgetIndexBytes(index),prior=previous.get(market)?.deref();ensureClean();
  console.log('PREPARED_WORKING_SET',JSON.stringify({cycle,market,ms,readCount,referenceEquality:cycle===1||!prior?null:prior===index,previousCollected:cycle>1&&!prior,bytes,rows:index.rows.length,memory:memory()}));
  // Do not pin evicted index objects merely to compare their identity.
  previous.set(market,new WeakRef(index));sizes.set(market,bytes);
 }
 const total=[...sizes.values()].reduce((a,b)=>a+b,0);
 console.log('PREPARED_WORKING_SET_SUMMARY',JSON.stringify({totalSerializedBytes:total,markets:Object.fromEntries(sizes),fits128MiB:total<=128*1024*1024,fits256MiB:total<=256*1024*1024,memory:memory(),retention:'weak-references-only',runnerNotServingProcess:true,notMemoryAcceptance:true}));
 ensureClean();
}

async function compare(){
 const reports=[];
 // Fresh processes prevent one variant from warming the other's caches.
 // ABBA also exposes order/network variability; no production request is made.
 for(const mode of ['sequential','parallel','parallel','sequential']){
  const p=spawnSync(process.execPath,['--import','tsx',process.argv[1],'--worker',mode],{encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024});
  if(p.status!==0){
   // Forward only our structured, redacted records. Never dump child stderr.
   for(const line of (p.stderr||'').split('\n'))if(line.startsWith('DIAGNOSTIC_ERROR ')){
    try{console.error('DIAGNOSTIC_ERROR',JSON.stringify(JSON.parse(line.slice('DIAGNOSTIC_ERROR '.length))));}catch{}
   }
   console.error('PROFILE_WORKER_FAILED',JSON.stringify({mode,status:p.status,signal:p.signal,spawnErrorCode:['ETIMEDOUT','ENOBUFS','ENOENT'].includes(p.error?.code)?p.error.code:null,bootstrapCode:['ERR_MODULE_NOT_FOUND','ERR_UNKNOWN_FILE_EXTENSION','MODULE_NOT_FOUND','JavaScript heap out of memory'].find(code=>(p.stderr||'').includes(code))||null}));process.exitCode=1;return;
  }
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
 else if(process.argv[2]==='--all-markets')await allMarkets();
 else if(process.argv[2]==='--compare')await compare();
 else throw Error('explicit diagnostic mode required');
}catch(error){console.error('DIAGNOSTIC_ERROR',JSON.stringify(errorInfo(error)));process.exitCode=1;}
