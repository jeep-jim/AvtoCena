import assert from 'node:assert/strict';import {AsyncLocalStorage} from 'node:async_hooks';
import {createSpoolWireBounds} from './bounded-spool-storage.mjs';
const BASE='https://s3.regru.cloud/avtocena-staging-8120751/migration-staging/full-20261011/';
/** Below raw-session storage, above unchanged ObjectJsonStorage. No new signing. */
export function installSpoolStorageBounds({storage,rawRoot,recoveryRoot,pages,signal}){
 assert.equal(storage.driver,'object','spool_installer_object_storage');assert.equal(typeof storage.readJson,'function');
 assert.equal(process.env.YC_OBJECT_STORAGE_ENDPOINT,'https://s3.regru.cloud','spool_installer_endpoint');assert.equal(process.env.YC_OBJECT_STORAGE_BUCKET,'avtocena-staging-8120751','spool_installer_bucket');assert.equal(String(process.env.YC_OBJECT_STORAGE_PREFIX||'').replace(/^\/+|\/+$/g,''),'migration-staging/full-20261011','spool_installer_prefix');
 const prior=globalThis.fetch;assert.equal(typeof prior,'function');const scope=new AsyncLocalStorage();let closing=false,closed=false;const pending=new Set(),boundsSet=new Set();
 const config={dispatch:(...args)=>Reflect.apply(prior,globalThis,args),baseUrl:BASE,rawRoot,recoveryRoot,pages,pageBytes:4*1024**2,pairBytes:4*1024**2,receiptBytes:64*1024,commitBytes:4096,manifestBytes:16*1024**2,signal};
 const wire=createSpoolWireBounds(config);boundsSet.add(wire);
 function keyCap(key){
  assert.equal(typeof key,'string');
  if(key===rawRoot+'/complete.json')return 64*1024;
  if(key===recoveryRoot+'/complete.json')return 16*1024**2;
  const source=key.startsWith(rawRoot+'/')&&/^(pages|page-receipts)\/([1-9]\d*)\.json$/.exec(key.slice(rawRoot.length+1));
  const dest=key.startsWith(recoveryRoot+'/')&&/^chunks\/([1-9]\d*)\/(data|commit)\.json$/.exec(key.slice(recoveryRoot.length+1));
  assert.ok(source||dest,'spool_bounded_key_scope');const n=Number(source?source[2]:dest[1]);assert.ok(Number.isSafeInteger(n)&&n<=pages,'spool_bounded_page');return source?(source[1]==='pages'?4*1024**2:64*1024):(dest[2]==='data'?4*1024**2:4096);
 }
 const installed=async(input,options={})=>{
  assert.ok(!closed,'spool_wire_closed');const context=scope.getStore();assert.ok(!closing||context,'spool_installer_closed');
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
  if(context){assert.equal(url.href,BASE+context.key,'spool_bounded_unexpected_target');assert.equal(String(options.method||input?.method||'GET').toUpperCase(),'GET','spool_bounded_unexpected_method');context.controller.signal.throwIfAborted();}
  const response=await(context?.wire||wire).fetch(input,options);
  if(!context)return response;
  context.status=response.status;context.bytes=0;context.calls++;
  if(!response.body)return response;
  const body=response.body.pipeThrough(new TransformStream({transform(value,c){context.bytes+=value.byteLength;assert.ok(context.bytes<=context.cap,'spool_bounded_response_limit');c.enqueue(value);}}));
  return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
 };
 globalThis.fetch=installed;
 const readJsonBounded=(key,maxBytes,{deadline}={})=>{
  assert.ok(!closing&&!closed,'spool_installer_closed');assert.equal(globalThis.fetch,installed,'spool_installer_fetch_owner');const max=keyCap(key);assert.ok(Number.isSafeInteger(maxBytes)&&maxBytes>0&&maxBytes<=16*1024**2,'spool_bounded_limit');
  if(deadline!==undefined)assert.ok(Number.isFinite(deadline)&&deadline>Date.now(),'spool_bounded_deadline');
  const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;const cap=Math.min(max,maxBytes);
  const requestWire=createSpoolWireBounds({...config,dispatch:(...args)=>wire.fetch(...args),pageBytes:Math.min(config.pageBytes,cap),pairBytes:Math.min(config.pairBytes,cap),receiptBytes:Math.min(config.receiptBytes,cap),commitBytes:Math.min(config.commitBytes,cap),manifestBytes:Math.min(config.manifestBytes,cap),signal:combined});boundsSet.add(requestWire);
  const context={key,cap,controller,wire:requestWire,status:null,bytes:0,calls:0};const timer=deadline===undefined?null:setTimeout(()=>controller.abort(),Math.max(1,deadline-Date.now()));
  const operation=scope.run(context,async()=>{try{combined.throwIfAborted();const value=await storage.readJson(key,null);combined.throwIfAborted();assert.ok(context.calls>0,'spool_bounded_no_wire');assert.ok([200,404].includes(context.status),'spool_bounded_status');return{found:context.status===200,value:context.status===200?value:null,bytes:context.bytes};}finally{if(timer)clearTimeout(timer);await requestWire.drain();boundsSet.delete(requestWire);}});
  pending.add(operation);void operation.finally(()=>pending.delete(operation)).catch(()=>{});return operation;
 };
 const boundedStorage=new Proxy(storage,{get(target,k){if(k==='readJsonBounded')return readJsonBounded;const v=Reflect.get(target,k);return typeof v==='function'?v.bind(target):v;}});
 return Object.freeze({storage:boundedStorage,async close(){closing=true;await Promise.allSettled([...pending]);await Promise.all([...boundsSet].map(x=>x.drain()));assert.equal(globalThis.fetch,installed,'spool_installer_fetch_owner');globalThis.fetch=prior;closed=true;},status:()=>({closing,closed,pending:pending.size})});
}
