import assert from 'node:assert/strict';
const fail=c=>{throw Error(c);};
/** Install as the fetch used by unchanged ObjectJsonStorage BEFORE constructing
 * raw-session wrappers. Signing/CAS and all coordination remain in original code.
 * Non-spool traffic is delegated to the caller's existing network fence. */
export function createSpoolWireBounds({dispatch,baseUrl,rawRoot,recoveryRoot,pages,
 pageBytes=8*1024**2,pairBytes=4*1024**2,receiptBytes=64*1024,commitBytes=4096,manifestBytes=16*1024**2,
 maxActiveBytes=64*1024**2,signal}){
 assert.equal(typeof dispatch,'function');const base=new URL(baseUrl);
 assert.equal(base.protocol,'https:');assert.ok(!base.search&&!base.hash&&!base.username&&!base.password&&base.pathname.endsWith('/'));
 assert.match(rawRoot,/^catalog\/intake-staging\/encar\/\d{1,20}\/[1-9]\d{0,5}$/);
 assert.match(recoveryRoot,/^catalog\/recovery-raw-spool\/v1\/[a-f0-9]{64}$/);
 assert.ok(Number.isSafeInteger(pages)&&pages>0&&pages<=100000);
 for(const n of[pageBytes,pairBytes,receiptBytes,commitBytes,manifestBytes,maxActiveBytes])assert.ok(Number.isSafeInteger(n)&&n>0&&n<=64*1024**2);
 assert.ok(Math.max(pageBytes,pairBytes,manifestBytes)<=maxActiveBytes);
 let activeBytes=0,peakBytes=0,active=0;const pending=new Set();
 const leaf=k=>{
  for(const [root,kind]of[[rawRoot,'raw'],[recoveryRoot,'recovery']]){
   if(k!==root&&!k.startsWith(root+'/'))continue;
   const rest=k.slice(root.length+1);if(rest==='complete.json')return{kind,cap:kind==='raw'?receiptBytes:manifestBytes};
   const m=kind==='raw'?/^(pages|page-receipts)\/([1-9]\d*)\.json$/.exec(rest):/^chunks\/([1-9]\d*)\/(data|commit)\.json$/.exec(rest);
   if(!m)fail('spool_wire_key');const page=Number(kind==='raw'?m[2]:m[1]);if(page>pages)fail('spool_wire_page');
   return{kind,cap:kind==='raw'?(m[1]==='pages'?pageBytes:receiptBytes):(m[2]==='data'?pairBytes:commitBytes)};
  }return null;
 };
 async function boundedFetch(input,options={}){
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
  const scope=url.origin===base.origin&&url.pathname.startsWith(base.pathname)?leaf(url.pathname.slice(base.pathname.length)):null;
  if(!scope)return dispatch(input,options); // Outer original fence remains mandatory.
  if(url.search||url.hash||url.username||url.password)fail('spool_wire_url');
  const method=String(options.method||input?.method||'GET').toUpperCase();
  const headers=new Headers(options.headers??input?.headers);const signals=[signal,options.signal??input?.signal].filter(Boolean);const requestSignal=signals.length?AbortSignal.any(signals):undefined;
  signal?.throwIfAborted();requestSignal?.throwIfAborted();
  if(!['GET','HEAD','PUT'].includes(method)||scope.kind==='raw'&&method==='PUT')fail('spool_wire_method');
  if(method==='PUT'){
   if(headers.get('if-none-match')!=='*'||headers.has('if-match'))fail('spool_wire_conditional');
   const body=options.body;if(typeof body!=='string'&&!(body instanceof Uint8Array))fail('spool_wire_body');
   if(Buffer.byteLength(body)>scope.cap)fail('spool_wire_body_bound');
  }else if(options.body!=null)fail('spool_wire_read_body');
  if(activeBytes+scope.cap>maxActiveBytes)fail('spool_wire_memory_budget');
  activeBytes+=scope.cap;active++;peakBytes=Math.max(peakBytes,activeBytes);let released=false,reader;
  let resolvePending;const completion=new Promise(r=>resolvePending=r);pending.add(completion);
  const release=()=>{if(released)return;released=true;activeBytes-=scope.cap;active--;pending.delete(completion);resolvePending();};
  try{
   const r=await dispatch(input,{...options,redirect:'error',signal:requestSignal});
   const length=r.headers.get('content-length'),encoding=r.headers.get('content-encoding');
   const cap=r.ok&&method!=='PUT'?scope.cap:Math.min(scope.cap,65536);
   if(encoding&&encoding!=='identity'||length!==null&&(!/^\d+$/.test(length)||Number(length)>cap)){
    await r.body?.cancel();fail('spool_wire_response_bound');
   }
   if(!r.body){release();return r;}
   reader=r.body.getReader();let total=0,closed=false,streamController;
   const cleanup=()=>{signal?.removeEventListener('abort',abort);if(requestSignal!==signal)requestSignal?.removeEventListener('abort',abort);release();};
   const abort=()=>{if(closed)return;closed=true;streamController?.error(Error('spool_wire_aborted'));void reader.cancel().catch(()=>{}).finally(cleanup);};
   const body=new ReadableStream({start(c){streamController=c;},async pull(c){
    try{signal?.throwIfAborted();requestSignal?.throwIfAborted();const{done,value}=await reader.read();if(closed)return;
     if(done){if(length!==null&&total!==Number(length))fail('spool_wire_length');closed=true;c.close();cleanup();return;}
     total+=value.byteLength;if(total>cap){await reader.cancel();fail('spool_wire_response_bound');}c.enqueue(value);
    }catch{if(!closed){closed=true;c.error(Error('spool_wire_read_failed'));await reader.cancel().catch(()=>{});cleanup();}}
   },async cancel(){if(!closed){closed=true;await reader.cancel().catch(()=>{});cleanup();}}});
   signal?.addEventListener('abort',abort,{once:true});if(requestSignal!==signal)requestSignal?.addEventListener('abort',abort,{once:true});
   if(signal?.aborted||requestSignal?.aborted)abort();
   return new Response(body,{status:r.status,statusText:r.statusText,headers:r.headers});
  }catch(error){release();throw error;}
 }
 return Object.freeze({fetch:boundedFetch,async drain(){await Promise.all([...pending]);},metrics:()=>({active,activeBytes,peakBytes}),
  limits:Object.freeze({pageBytes,pairBytes,receiptBytes,commitBytes,manifestBytes,maxActiveBytes}),
  // Adapter wraps actual raw-session storage, never its underlying uncoordinated base.
  scopeStores({reader,writer}){
   return Object.freeze({upstream:Object.freeze({readJson:(key,fallback)=>{const x=leaf(key);assert.equal(x?.kind,'raw','spool_upstream_scope');return reader.readJson(key,fallback);}}),
    store:Object.freeze({readJson:(key,fallback)=>{const x=leaf(key);assert.equal(x?.kind,'recovery','spool_store_scope');return writer.readJson(key,fallback);},writeJson:(key,value,condition)=>{const x=leaf(key);assert.equal(x?.kind,'recovery','spool_store_scope');assert.deepEqual(condition,{ifNoneMatch:'*'});assert.ok(Buffer.byteLength(JSON.stringify(value))<=x.cap,'spool_write_bound');return writer.writeJson(key,value,condition);}})});
  }});
}
