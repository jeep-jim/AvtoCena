import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import http from 'node:http';import https from 'node:https';import {syncBuiltinESMExports} from 'node:module';
import {inspectPairs} from './inspect-encar-conflict-pairs.mjs';
let forbidden=0;
try{
 const plan=JSON.parse(readFileSync(new URL('./encar-conflict-pairs.json',import.meta.url),'utf8'));
 assert.equal(process.env.JSON_STORAGE_DRIVER,'object');assert.equal(process.env.YC_OBJECT_STORAGE_ENDPOINT,'https://s3.regru.cloud');assert.equal(process.env.YC_OBJECT_STORAGE_BUCKET,'avtocena-staging-8120751');assert.equal(process.env.YC_OBJECT_STORAGE_PREFIX,'migration-staging/full-20261011/');
 const pages=new Set(plan.conflicts.flatMap(c=>[c.previous.page,c.incoming.page]));
 const paths=new Set([plan.root+'/complete.json']);for(const p of pages){paths.add(plan.root+'/pages/'+p+'.json');for(const r of [p-1,p,p+1])if(r>=1&&r<=plan.pages)paths.add(plan.root+'/page-receipts/'+r+'.json');}
 const deny=()=>{forbidden++;throw Error('diagnostic_forbidden');};
 const fetch=globalThis.fetch.bind(globalThis),prefix='/avtocena-staging-8120751/migration-staging/full-20261011/';
 globalThis.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input)),method=String(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();const path=decodeURIComponent(url.pathname);if(!['GET','HEAD'].includes(method)||url.origin!=='https://s3.regru.cloud'||url.search||!path.startsWith(prefix)||!paths.has(path.slice(prefix.length)))return deny();return fetch(input,{...init,redirect:'error'});};
 for(const transport of [http,https]){transport.request=deny;transport.get=deny;}syncBuiltinESMExports();
 const {getJsonStorage}=await import('../apps/web/lib/data.ts');const source=getJsonStorage();assert.equal(source.driver,'object');
 for(const name of ['writeJson','deleteJson','putBinary','deleteBinary','deleteObjects','deletePrefix'])Object.defineProperty(source,name,{value:async()=>deny(),writable:false});
 let reads=0;const storage=Object.freeze({readJson:async(path,fallback)=>{if(!paths.has(path))return deny();reads++;return source.readJson(path,fallback);}});
 const report=await inspectPairs({storage,plan});assert.equal(forbidden,0);
 console.log('ENCAR_CONFLICT_PAIR_STRUCTURE',JSON.stringify({...report,reads,storageWrites:0,providerRequests:0,forbiddenAttempts:forbidden}));
}catch{console.error('ENCAR_CONFLICT_PAIR_DIAGNOSTIC_FAILED',JSON.stringify({forbiddenAttempts:forbidden}));process.exitCode=1;}
