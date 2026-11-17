import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import http from 'node:http';import https from 'node:https';import {syncBuiltinESMExports} from 'node:module';
const ROOT='catalog/intake-staging/encar/43989797288/1',PIN='c34e0546b1214a3829b7b6317f87c2ff3be05ff8bc9cd7c0ec5db0e212b7ac43';
export function allowedPrepareWrite(key,{run,attempt,reportMillis}){
 if(key==='catalog/raw-feed-coordination/v1/state.json')return true;
 if(/^catalog\/raw-feed-pins\/v1\/[a-zA-Z0-9_.-]+\.json$/.test(key))return true;
 if(/^catalog\/raw-feed-handoffs\/v1\/(?:encar-reports|nonjp-intake)\/[a-f0-9]{64}\.json$/.test(key))return true;
 return key.startsWith(`catalog/nonjp-intake/v1/korea/${run}/${attempt}/`)||Number.isSafeInteger(reportMillis)&&key.startsWith(`catalog/paid-encar-reports/v1/${reportMillis}/`);
}
export function prepareRequestAllowed(input,method,context){
 const u=new URL(input),prefix='/avtocena-staging-8120751/migration-staging/full-20261011/';
 if(u.origin!=='https://s3.regru.cloud'||u.username||u.password)return false;
 const p=decodeURIComponent(u.pathname);if(p.includes('/../')||p.includes('/./'))return false;
 if(['GET','HEAD'].includes(method))return p.startsWith(prefix)||['/avtocena-staging-8120751','/avtocena-staging-8120751/'].includes(p);
 return method==='PUT'&&!u.search&&p.startsWith(prefix)&&allowedPrepareWrite(p.slice(prefix.length),context);
}
export function lockPrepareStorage(storage,context,deny){
 const originalWrite=storage.writeJson.bind(storage);
 // The raw-provenance layer wraps storage in a Proxy. Configurable descriptors
 // preserve its get invariants; the independent HTTP allowlist still enforces
 // the same write boundary even if a wrapper is replaced.
 Object.defineProperty(storage,'writeJson',{value:async(key,value,conditions)=>{if(!allowedPrepareWrite(key,context()))return deny();return originalWrite(key,value,conditions);},writable:false,configurable:true});
 for(const k of ['deleteJson','deleteBinary','deleteObjects','deletePrefix','putBinary'])Object.defineProperty(storage,k,{value:async()=>deny(),writable:false,configurable:true});
}
export async function installPrepareGuard(){
 assert.equal(process.env.JSON_STORAGE_DRIVER,'object');assert.equal(process.env.YC_OBJECT_STORAGE_ENDPOINT,'https://s3.regru.cloud');
 assert.equal(process.env.YC_OBJECT_STORAGE_BUCKET,'avtocena-staging-8120751');assert.equal(process.env.YC_OBJECT_STORAGE_PREFIX,'migration-staging/full-20261011/');
 const run=process.env.GITHUB_RUN_ID,attempt=process.env.GITHUB_RUN_ATTEMPT;assert.match(run||'',/^\d+$/);assert.match(attempt||'',/^[1-9]\d*$/);
 let forbidden=0,reportMillis=null;const context=()=>({run,attempt,reportMillis});
 const deny=()=>{forbidden++;throw Error('prepare_only_operation_forbidden');};
 const originalFetch=globalThis.fetch.bind(globalThis);
 globalThis.fetch=(input,init)=>{const url=input instanceof Request?input.url:String(input),method=String(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();if(!prepareRequestAllowed(url,method,context()))return deny();return originalFetch(input,{...init,redirect:'error'});};
 for(const x of [http,https]){x.request=deny;x.get=deny;}syncBuiltinESMExports();
 process.on('beforeExit',()=>{if(forbidden){console.error('PREPARE_ONLY_FORBIDDEN_ATTEMPTS',forbidden);process.exitCode=1;}});
 const {getJsonStorage}=await import('../apps/web/lib/data.ts');const storage=getJsonStorage();assert.equal(storage.driver,'object');
 const snapshot=await storage.readJson(ROOT+'/complete.json',null);
 assert.equal(createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),PIN,'prepare_only_snapshot_pin');
 reportMillis=Date.parse(snapshot.completedAt);assert.ok(Number.isSafeInteger(reportMillis));
 lockPrepareStorage(storage,context,deny);
}
if(process.env.ENCAR_PREPARE_ONLY_GUARD==='1')await installPrepareGuard();
