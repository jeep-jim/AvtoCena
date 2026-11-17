import fs from 'node:fs/promises';import path from 'node:path';import {createReadStream}from'node:fs';import{createHash,createHmac,randomUUID}from'node:crypto';
const fail=code=>{throw Error(code);};const sha=x=>createHash('sha256').update(x).digest('hex'),hmac=(k,v)=>createHmac('sha256',k).update(v).digest();
export function signRead(url,method,env,extra={},now=new Date()){
 if(!['GET','HEAD'].includes(method)||url.protocol!=='https:'||url.search||url.username||url.password)fail('range_sign_inputs');
 const namesExtra=Object.keys(extra);if(namesExtra.some(k=>!['range','if-match'].includes(k)))fail('range_sign_headers');
 if(!env.YC_OBJECT_STORAGE_ACCESS_KEY_ID||!env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY||!env.YC_OBJECT_STORAGE_REGION)fail('range_sign_credentials');
 const stamp=now.toISOString().replace(/[:-]|\.\d{3}/g,''),day=stamp.slice(0,8),scope=`${day}/${env.YC_OBJECT_STORAGE_REGION}/s3/aws4_request`,payload=sha('');
 const headers={host:url.host,'x-amz-date':stamp,'x-amz-content-sha256':payload,...extra},names=Object.keys(headers).sort();
 const canonical=[method,url.pathname,'',names.map(k=>`${k}:${headers[k]}\n`).join(''),names.join(';'),payload].join('\n');
 const key=hmac(hmac(hmac(hmac('AWS4'+env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY,day),env.YC_OBJECT_STORAGE_REGION),'s3'),'aws4_request');
 const signature=createHmac('sha256',key).update(`AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${sha(canonical)}`).digest('hex');
 headers.authorization=`AWS4-HMAC-SHA256 Credential=${env.YC_OBJECT_STORAGE_ACCESS_KEY_ID}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;return headers;
}
export function headIdentity(response){
 const raw=response.headers.get('content-length'),etag=response.headers.get('etag');
 if(response.status!==200||!/^\d+$/.test(raw??'')||!Number.isSafeInteger(Number(raw))||Number(raw)<=0||!/^"[^"\r\n]+"$/.test(etag??''))fail('range_head_invalid');
 if(![null,'identity'].includes(response.headers.get('content-encoding')))fail('range_encoding_unsupported');
 return{length:Number(raw),etag,version:response.headers.get('x-amz-version-id')};
}
function assertPart(response,pinned,start,end){
 if(response.status!==206)fail(response.status===412?'range_version_changed':'range_status_invalid');
 if(response.headers.get('content-range')!==`bytes ${start}-${end}/${pinned.length}`||response.headers.get('content-length')!==String(end-start+1))fail('range_bounds_invalid');
 if(response.headers.get('etag')!==pinned.etag||response.headers.get('x-amz-version-id')!==pinned.version)fail('range_version_changed');
 if(![null,'identity'].includes(response.headers.get('content-encoding')))fail('range_encoding_unsupported');
}
// request(method, headers, signal) MUST pass each independently signed request through existing outer fences.
export async function downloadRanges({request,directory,signal,chunkBytes=8*1024**2,concurrency=4,maxAttempts=3,deadlineMs=900000,partTimeoutMs=120000,maxBytes=640*1024**2,expectedSha256=null,expectedIdentity=null,expectedLength=null,maxChunks=160,maxRequests=482}){
 if(!Number.isInteger(chunkBytes)||chunkBytes<=0||chunkBytes>8*1024**2||!Number.isInteger(concurrency)||concurrency<1||concurrency>4||!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>3||!Number.isInteger(deadlineMs)||deadlineMs<=0||deadlineMs>900000||!Number.isInteger(partTimeoutMs)||partTimeoutMs<=0||partTimeoutMs>120000||!Number.isInteger(maxBytes)||maxBytes<=0||maxBytes>640*1024**2||!Number.isInteger(maxChunks)||maxChunks<1||maxChunks>160||!Number.isInteger(maxRequests)||maxRequests<2||maxRequests>482)fail('range_limits_invalid');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),deadlineMs),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
 const check=()=>{if(combined.aborted)fail('range_deadline_or_abort');};
 const temp=path.join(directory,randomUUID()+'.range.partial');let file=null,complete=false,destination=null;
 const metrics={requests:0,retries:0,chunks:0,bytes:0,wireBytes:0,elapsedMs:0};const began=performance.now();
 const call=async(method,headers,sig=combined)=>{check();if(metrics.requests>=maxRequests)fail('range_request_quota');metrics.requests++;return request(method,headers,sig);};
 try{
  await fs.mkdir(directory,{recursive:true,mode:0o700});const initial=await call('HEAD',{});let pinned;try{pinned=headIdentity(initial);}finally{await initial.body?.cancel();}
  if(expectedIdentity&&JSON.stringify(pinned)!==JSON.stringify(expectedIdentity))fail('range_version_changed');if(pinned.length>maxBytes)fail('range_capacity');if(expectedLength!==null&&pinned.length!==expectedLength)fail('range_expected_length');if(Math.ceil(pinned.length/chunkBytes)>maxChunks)fail('range_chunk_quota');file=await fs.open(temp,'wx',0o600);await file.truncate(pinned.length);
  const count=Math.ceil(pinned.length/chunkBytes);let cursor=0;const finished=new Set();let failure=null;
  async function part(index){const start=index*chunkBytes,end=Math.min(pinned.length-1,start+chunkBytes-1);let last;
   for(let attempt=0;attempt<maxAttempts;attempt++){
    check();if(attempt){metrics.retries++;await new Promise(r=>setTimeout(r,Math.min(100*2**(attempt-1),500)));check();}
    const partController=new AbortController(),partTimer=setTimeout(()=>partController.abort(),partTimeoutMs),partSignal=AbortSignal.any([combined,partController.signal]);let response,reader;
    try{
     response=await call('GET',{range:`bytes=${start}-${end}`,'if-match':pinned.etag},partSignal);
     if([408,429,500,502,503,504].includes(response.status))throw Error('range_transient_status');
     assertPart(response,pinned,start,end);if(!response.body)fail('range_body_missing');reader=response.body.getReader();let received=0;
     for(;;){check();if(partSignal.aborted)fail('range_part_timeout');const {done,value}=await reader.read();if(done)break;metrics.wireBytes+=value.length;if(received+value.length>end-start+1)fail('range_body_overflow');let offset=0;while(offset<value.length){const written=await file.write(value,offset,value.length-offset,start+received+offset);if(!written.bytesWritten)fail('range_disk_write_failed');offset+=written.bytesWritten;}received+=value.length;}
     if(received!==end-start+1)fail('range_body_short');finished.add(index);metrics.chunks++;metrics.bytes+=received;return;
    }catch(error){last=error;const retryable=['range_transient_status','range_body_short','range_part_timeout','terminated','fetch failed'].includes(error.message)||['ECONNRESET','ETIMEDOUT','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT'].includes(error.code)||['ECONNRESET','ETIMEDOUT','UND_ERR_SOCKET'].includes(error.cause?.code)||partController.signal.aborted;if(!retryable)throw error;check();}
    finally{clearTimeout(partTimer);if(reader){await reader.cancel().catch(()=>{});reader.releaseLock();}else await response?.body?.cancel().catch(()=>{});}
   }
   throw Error(last?.message?.startsWith('range_')?last.message:'range_part_transport_exhausted');
  }
  await Promise.all(Array.from({length:Math.min(concurrency,count)},async()=>{try{for(;;){check();const index=cursor++;if(index>=count)return;await part(index);}}catch(error){failure??=error;controller.abort();}}));
  if(failure)throw failure;check();if(finished.size!==count||metrics.bytes!==pinned.length)fail('range_incomplete');
  await file.sync();await file.close();file=null;
  const hash=createHash('sha256');let length=0;for await(const chunk of createReadStream(temp,{signal:combined})){check();length+=chunk.length;hash.update(chunk);}const digest=hash.digest('hex');if(length!==pinned.length||expectedSha256&&digest!==expectedSha256)fail('range_digest_mismatch');
  const final=await call('HEAD',{});let finalIdentity;try{finalIdentity=headIdentity(final);}finally{await final.body?.cancel();}
  if(JSON.stringify(finalIdentity)!==JSON.stringify(pinned))fail('range_version_changed');check();
  destination=path.join(directory,randomUUID()+'.'+digest+'.complete');await fs.rename(temp,destination);check();complete=true;metrics.elapsedMs=Math.round(performance.now()-began);return{path:destination,...pinned,sha256:digest,metrics};
 }finally{clearTimeout(timer);await file?.close().catch(()=>{});if(!complete){await fs.rm(temp,{force:true});if(destination)await fs.rm(destination,{force:true});}}
}
