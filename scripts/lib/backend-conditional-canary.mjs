import {createHash,createHmac} from 'node:crypto';
export const KEY='catalog/generations/gen_1794878284419_a611dfcf/indexes/budget-markets-v3/ready.json';
export const URL_FIXED='https://s3.regru.cloud/avtocena-staging-8120751/migration-staging/full-20261011/'+KEY;
export const sha=v=>createHash('sha256').update(v).digest('hex');const hmac=(k,v)=>createHmac('sha256',k).update(v).digest();
export function signConditional(method,url,env,conditions={},now=new Date()){
 if(!['HEAD','GET'].includes(method)||url.href!==URL_FIXED||!env.YC_OBJECT_STORAGE_ACCESS_KEY_ID||!env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY||env.YC_OBJECT_STORAGE_REGION!=='us-east-1')throw Error('canary_sign_inputs');
 if(Object.entries(conditions).some(([k,v])=>!['if-match','if-none-match'].includes(k)||typeof v!=='string'||/[\r\n]/.test(v)||v.length>260)||Object.keys(conditions).length>1)throw Error('canary_condition');
 const stamp=now.toISOString().replace(/[:-]|\.\d{3}/g,''),day=stamp.slice(0,8),scope=`${day}/${env.YC_OBJECT_STORAGE_REGION}/s3/aws4_request`,payload=sha('');
 const headers={host:url.host,'x-amz-content-sha256':payload,'x-amz-date':stamp,...conditions},names=Object.keys(headers).sort();
 const canonical=[method,url.pathname,'',names.map(k=>`${k}:${headers[k].trim()}\n`).join(''),names.join(';'),payload].join('\n');
 const key=hmac(hmac(hmac(hmac('AWS4'+env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY,day),env.YC_OBJECT_STORAGE_REGION),'s3'),'aws4_request');
 headers.authorization=`AWS4-HMAC-SHA256 Credential=${env.YC_OBJECT_STORAGE_ACCESS_KEY_ID}/${scope}, SignedHeaders=${names.join(';')}, Signature=${createHmac('sha256',key).update(`AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${sha(canonical)}`).digest('hex')}`;
 return headers;
}
export async function runCanary({fetchImpl,env,deadline=Date.now()+60000,now=Date.now,events=[]}){
 const remaining=deadline-now();if(remaining<=0)throw Error('canary_deadline');const signal=AbortSignal.timeout(remaining);let requests=0;
 const call=async(label,method,conditions,expected)=>{
  if(++requests>8||now()>=deadline)throw Error('canary_request_budget');
  const response=await fetchImpl(URL_FIXED,{method,headers:signConditional(method,new URL(URL_FIXED),env,conditions),signal,redirect:'error'});
  const etag=response.headers.get('etag'),length=response.headers.get('content-length'),encoding=response.headers.get('content-encoding'),version=response.headers.get('x-amz-version-id');let bytes=0;
  if(encoding!==null&&encoding!=='identity')throw Error('canary_encoding');
  if(response.body){const reader=response.body.getReader();const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});try{while(true){const part=await reader.read();if(signal.aborted)throw Error('canary_deadline');if(part.done)break;bytes+=part.value.byteLength;if(bytes>131072){void reader.cancel().catch(()=>{});throw Error('canary_body_limit');}}}finally{signal.removeEventListener('abort',abort);}}
  events.push({stage:label,status:response.status,size:bytes,contentLength:/^\d{1,8}$/.test(length||'')?Number(length):null,etagHash:etag?sha(etag):null,versionPresent:version!==null,versionHash:version===null?null:sha(version)});
  if(response.status!==expected)throw Error('canary_status_mismatch');
  return {etag,length,bytes,version};
 };
 const initial=await call('initial_head','HEAD',{},200);
 if(!/^"[^"\\\x00-\x20\x7f]{1,250}"$/.test(initial.etag||'')||!/^\d+$/.test(initial.length||'')||Number(initial.length)>131072||Number(initial.length)<1)throw Error('canary_initial_metadata');
 const E=initial.etag,wrong='"'+sha('deliberately-wrong:'+E)+'"';if(wrong===E)throw Error('canary_wrong_etag_collision');
 const get=await call('get_if_match','GET',{'if-match':E},200);if(get.version!==initial.version||get.etag!==E||get.bytes!==Number(initial.length)||Number(get.length)!==get.bytes)throw Error('canary_full_body_mismatch');
 const matched=await call('head_if_match','HEAD',{'if-match':E},200);if(matched.etag!==E||matched.length!==initial.length)throw Error('canary_match_metadata');
 await call('head_wrong_if_match','HEAD',{'if-match':wrong},412);
 await call('head_weak_if_match','HEAD',{'if-match':'W/'+E},412);
 const head304=await call('head_if_none_match','HEAD',{'if-none-match':E},304);if(head304.bytes!==0)throw Error('canary_304_body');
 const get304=await call('get_if_none_match','GET',{'if-none-match':E},304);if(get304.bytes!==0)throw Error('canary_304_body');
 const final=await call('final_head','HEAD',{},200);if(final.version!==initial.version||final.etag!==E||final.length!==initial.length)throw Error('canary_object_changed');
 return {verified:true,requests,events};
}
