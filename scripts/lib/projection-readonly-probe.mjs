import {createHash} from 'node:crypto';
export const PROJECTION_KEYS=['china','korea'].map(m=>`catalog/generations/gen_1794878284419_a611dfcf/indexes/projection/${m}.json`);
export const READY_KEY='catalog/generations/gen_1794878284419_a611dfcf/indexes/budget-markets-v7/'+createHash('sha256').update(JSON.stringify(['bf2c72cb7a260ef093c0a43c2b0dad9c4c9094a4d6dc3811dd0d7f7626b0d72b','71a38f23e25b0dd93e2cb3c2df8092c8c44ab1a524770576f8306952fb15e1f4'])).digest('hex')+'/ready.json';
const BASE='https://s3.regru.cloud/avtocena-staging-8120751/migration-staging/full-20261011/';
export function probeRequest(input,init={}){
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url),method=String(init.method||input?.method||'GET').toUpperCase();
 const key=[...PROJECTION_KEYS,READY_KEY].find(k=>url.href===BASE+k);
 if(!key||!['HEAD','GET'].includes(method)||method==='GET'&&key!==PROJECTION_KEYS[0]||init.body!=null)throw Error('projection_probe_request_forbidden');
 return {key,method};
}
// Exact allowlist, not arbitrary stderr/message extraction. Unknown text never escapes.
export function safeProbeCode(error){
 const message=String(error?.message||'');
 const suffix=PROJECTION_KEYS.some(k=>message.endsWith(':path='+k+':bytes=0'));
 const known=/^(object_storage_(?:GET|HEAD)_unreachable:(?:object_storage_response_timeout|object_storage_read_deadline|This operation was aborted|The operation was aborted\.|fetch failed|projection_probe_deadline|projection_probe_request_quota|projection_probe_body_limit))(?=:path=|$)/.exec(message);
 if(known&&(suffix||message===known[1]))return known[1];
 const status=/^(object_storage_(?:GET|HEAD)_[1-5]\d\d)(?=:|$)/.exec(message);if(status)return status[1];
 if(['projection_probe_request_forbidden','projection_probe_request_quota','projection_probe_deadline','projection_probe_body_limit'].includes(message))return message;
 return 'projection_probe_error_redacted';
}
export function createProbeFetch(fetchImpl,{deadline=Date.now()+120000,now=Date.now,events=[]}={}){
 const used=new Set();
 return async(input,init={})=>{
  const {key,method}=probeRequest(input,init),requestId=method+':'+key;
  if(used.has(requestId))throw Error('projection_probe_request_quota');used.add(requestId);
  const remaining=deadline-now();if(remaining<=0)throw Error('projection_probe_deadline');
  const start=now(),event={key,method,status:null,headerMs:null,elapsedMs:null,bytes:0,contentLength:null,contentEncoding:null,complete:false};events.push(event);
  const timeout=AbortSignal.timeout(Math.max(1,Math.floor(remaining))),signal=init.signal?AbortSignal.any([init.signal,timeout]):timeout;
  let response;
  try{response=await fetchImpl(input,{...init,signal,redirect:'error'});}catch{event.elapsedMs=now()-start;throw Error(signal.aborted?'projection_probe_deadline':'fetch failed');}
  event.status=response.status;event.headerMs=now()-start;
  const size=response.headers.get('content-length'),encoding=response.headers.get('content-encoding');
  event.contentLength=/^\d{1,12}$/.test(size||'')?Number(size):null;event.contentEncoding=['gzip','br','deflate','identity'].includes(encoding)?encoding:null;
  if(method==='HEAD'||!response.body){event.complete=true;event.elapsedMs=now()-start;return response;}
  const reader=response.body.getReader();let closed=false;
  const body=new ReadableStream({
   async pull(controller){try{const {done,value}=await reader.read();if(done){if(signal.aborted)throw Error('projection_probe_deadline');closed=true;event.complete=true;event.elapsedMs=now()-start;controller.close();return;}event.bytes+=value.byteLength;if(event.bytes>256*1024*1024)throw Error('projection_probe_body_limit');controller.enqueue(value);}catch(error){closed=true;event.elapsedMs=now()-start;controller.error(error);void reader.cancel().catch(()=>{});}},
   cancel(){closed=true;event.elapsedMs=now()-start;return reader.cancel();}
  });
  signal.addEventListener('abort',()=>{if(!closed){event.elapsedMs=now()-start;void reader.cancel().catch(()=>{});}},{once:true});
  return new Response(body,{status:response.status,statusText:'',headers:response.headers});
 };
}
