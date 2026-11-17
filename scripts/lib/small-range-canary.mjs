import {createHash,createHmac} from 'node:crypto';
export const KEY='catalog/generations/gen_1794878284419_a611dfcf/indexes/projection/china.json';
export const URL_FIXED='https://s3.regru.cloud/avtocena-staging-8120751/migration-staging/full-20261011/'+KEY;
export const sha=v=>createHash('sha256').update(v).digest('hex');const hmac=(k,v)=>createHmac('sha256',k).update(v).digest();
export function signConditional(method,url,env,conditions={},now=new Date()){
 if(!['HEAD','GET'].includes(method)||url.href!==URL_FIXED||!env.YC_OBJECT_STORAGE_ACCESS_KEY_ID||!env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY||env.YC_OBJECT_STORAGE_REGION!=='us-east-1')throw Error('canary_sign_inputs');
 if(Object.entries(conditions).some(([k,v])=>!['if-match','range'].includes(k)||typeof v!=='string'||/[\r\n]/.test(v)||v.length>260)||Object.keys(conditions).length>2)throw Error('canary_condition');
 if(method==='GET'&&(conditions.range!=='bytes=0-65535'||!conditions['if-match']))throw Error('canary_required_range');
 if(method==='HEAD'&&Object.keys(conditions).length)throw Error('canary_head_condition');
 const stamp=now.toISOString().replace(/[:-]|\.\d{3}/g,''),day=stamp.slice(0,8),scope=`${day}/${env.YC_OBJECT_STORAGE_REGION}/s3/aws4_request`,payload=sha('');
 const headers={host:url.host,'x-amz-content-sha256':payload,'x-amz-date':stamp,...conditions},names=Object.keys(headers).sort();
 const canonical=[method,url.pathname,'',names.map(k=>`${k}:${headers[k].trim()}\n`).join(''),names.join(';'),payload].join('\n');
 const key=hmac(hmac(hmac(hmac('AWS4'+env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY,day),env.YC_OBJECT_STORAGE_REGION),'s3'),'aws4_request');
 headers.authorization=`AWS4-HMAC-SHA256 Credential=${env.YC_OBJECT_STORAGE_ACCESS_KEY_ID}/${scope}, SignedHeaders=${names.join(';')}, Signature=${createHmac('sha256',key).update(`AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${sha(canonical)}`).digest('hex')}`;
 return headers;
}
export async function runCanary({fetchImpl,env,deadline=Date.now()+60000,now=Date.now,events=[]}) {
 const remaining=deadline-now(); if(remaining<=0)throw Error('range_deadline'); const signal=AbortSignal.timeout(remaining);let requests=0;
 const call=async(stage,method,conditions,status,initial=null)=>{
  if(++requests>4||now()>=deadline)throw Error('range_budget');
  const r=await fetchImpl(URL_FIXED,{method,headers:signConditional(method,new URL(URL_FIXED),env,conditions),signal,redirect:'error'});
  const etag=r.headers.get('etag'),length=r.headers.get('content-length'),version=r.headers.get('x-amz-version-id'),encoding=r.headers.get('content-encoding');
  events.push({stage,status:r.status,etagHash:etag?sha(etag):null,versionHash:version===null?null:sha(version),bytes:0});
  const fail=code=>{void r.body?.cancel().catch(()=>{});throw Error(code);};
  if(r.status!==status)fail('range_status');
  if(encoding!==null&&encoding!=='identity')fail('range_encoding');
  if(status===206&&(etag!==initial.etag||version!==initial.version||length!=='65536'||r.headers.get('content-range')!==`bytes 0-65535/${initial.length}`))fail('range_metadata');
  let bytes=0;const hash=createHash('sha256');
  if(r.body){const reader=r.body.getReader(),abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});try{while(true){const item=await reader.read();if(signal.aborted)throw Error('range_deadline');if(item.done)break;bytes+=item.value.byteLength;if(bytes>65536){void reader.cancel().catch(()=>{});throw Error('range_body_limit');}hash.update(item.value);}}finally{signal.removeEventListener('abort',abort);}}
  events.at(-1).bytes=bytes;if(status===206){if(bytes!==65536)throw Error('range_truncated');events.at(-1).bodySha256=hash.digest('hex');}
  if(method==='HEAD'&&bytes!==0)throw Error('range_head_body');return {etag,length,version};
 };
 const first=await call('initial_head','HEAD',{},200);
 if(!/^"[^"\\\x00-\x20\x7f]{1,250}"$/.test(first.etag||'')||!/^\d{1,12}$/.test(first.length||'')||Number(first.length)<65536)throw Error('range_initial_metadata');
 await call('matched_range','GET',{'if-match':first.etag,range:'bytes=0-65535'},206,first);
 const wrong='"'+sha('deliberately-wrong:'+first.etag)+'"';if(wrong===first.etag)throw Error('range_etag_collision');
 await call('wrong_if_match_range','GET',{'if-match':wrong,range:'bytes=0-65535'},412);
 const last=await call('final_head','HEAD',{},200);if(last.etag!==first.etag||last.version!==first.version||last.length!==first.length)throw Error('range_object_changed');
 return {verified:true,requests,events};
}
