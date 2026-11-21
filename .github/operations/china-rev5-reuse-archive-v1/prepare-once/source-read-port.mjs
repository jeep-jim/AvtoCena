// Same fixed-host SigV4 GET form already used by verified V4 custody.
// No alternate credentials, redirects, listing, PUTs or path discovered from a URL.
import {createHash,createHmac} from 'node:crypto';
import {guard} from '../rev5-successor-core.mjs';
const M=1024**2,MAX=17*M,NATIVE_MAX=4*M;
const HOST='s3.regru.cloud',REGION='us-east-1',PREFIX='/avtocena-staging-8120751/migration-staging/full-20261011/';
const U='[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
const largePath=new RegExp('^catalog/(?:intake-working/che168-v1/[1-9][0-9]{0,19}/'+U+'\\.json|provider-replicas/che168/'+U+'/(?:0|[1-9][0-9]{0,2})\\.gz)$');
const sha=v=>createHash('sha256').update(v).digest('hex'),hmac=(k,s)=>createHmac('sha256',k).update(s).digest();
const need=(v,k)=>guard(v,'source_io_'+k);
export function createLargeSourceReader({cred,fetchImpl,expires,clock=Date.now}){
 need(cred&&typeof cred.access==='string'&&typeof cred.secret==='string'&&typeof fetchImpl==='function'&&Number.isSafeInteger(expires),'read_authority');
 return async(key,cap)=>{
  need(largePath.test(key)&&Number.isSafeInteger(cap)&&cap>NATIVE_MAX&&cap<=MAX&&clock()<expires,'exact_derived_large_get_only');
  const empty=sha(''),time=new Date(clock()).toISOString().replace(/[:-]|\.\d{3}/g,''),day=time.slice(0,8);
  const route=PREFIX+key,scope=day+'/'+REGION+'/s3/aws4_request',names='host;x-amz-content-sha256;x-amz-date';
  const headers={host:HOST,'x-amz-content-sha256':empty,'x-amz-date':time};
  const canonical='GET\n'+route+'\n\n'+['host','x-amz-content-sha256','x-amz-date'].map(n=>n+':'+headers[n]+'\n').join('')+'\n'+names+'\n'+empty;
  const signature=createHmac('sha256',hmac(hmac(hmac(hmac('AWS4'+cred.secret,day),REGION),'s3'),'aws4_request'))
   .update(['AWS4-HMAC-SHA256',time,scope,sha(canonical)].join('\n')).digest('hex');
  headers.authorization='AWS4-HMAC-SHA256 Credential='+cred.access+'/'+scope+', SignedHeaders='+names+', Signature='+signature;
  let r;
  try{r=await fetchImpl('https://'+HOST+route,{method:'GET',headers,redirect:'error',
   signal:AbortSignal.timeout(Math.max(1,Math.min(25000,expires-clock())))});}
  catch{need(false,'large_get_transport');}
  const rawLen=r.headers.get('content-length'),length=typeof rawLen==='string'&&/^\d{1,12}$/.test(rawLen)?Number(rawLen):0;
  const e=r.headers.get('etag');
  if(r.status!==200||!r.body||length<=0||length>cap||typeof e!=='string'||!/^(?:W\/)?"[^"\r\n]{1,128}"$/.test(e)||r.headers.get('content-encoding')){
   await r.body?.cancel?.().catch(()=>{});
   need(false,r.status!==200&&/^\d{3}$/.test(String(r.status))?'large_get_http_'+r.status:'large_get_wire_shape');
  }
  const data=Buffer.alloc(length);let total=0;
  try{for await(const chunk of r.body){need(clock()<expires&&total+chunk.byteLength<=length,'large_get_body_bounds');data.set(chunk,total);total+=chunk.byteLength;}}
  catch(e){if(typeof e?.message==='string'&&e.message.startsWith('china_rev5_successor:source_io_'))throw e;need(false,'large_get_stream');}
  need(total===length&&clock()<expires,'large_get_body_readback');
  return {data,size:total,checksum:sha(data)};
 };
}
export async function readKnownSourceObject({storage,largeRead,key,cap}){
 need(Number.isSafeInteger(cap)&&cap>0&&cap<=MAX,'object_read_cap');
 if(cap>NATIVE_MAX){
  need(typeof largeRead==='function','large_read_binding');
  return largeRead(key,cap);
 }
 try{return await storage.getBinaryBounded(key,cap);}
 catch(e){
  const safe=String(e?.message??'').match(/^object_storage_binary_read_(\d{3})$/);
  need(false,safe?'native_get_http_'+safe[1]:'native_small_get_transport');
 }
}
