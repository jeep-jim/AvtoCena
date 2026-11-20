import assert from 'node:assert/strict';
import { createHash,createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const gen='gen_1794878284419_a611dfcf';
const root='catalog/generations/'+gen+'/indexes/projection/europe.json';
const paths={public:'catalog/manifest.json',internal:'catalog/internal/manifest.json',lease:'catalog/import-lock.json'};
const host='s3.regru.cloud',prefix='/avtocena-staging-8120751/migration-staging/full-20261011/';
export const scope=Object.freeze({gen,root,paths:Object.freeze(paths),host,prefix});
const pubSha='4c34c20d9784b571414390cab450ceeeaee60b00c168476100419ec5c05cb038';
const pubEtag='426ac1af32eb10b21d3beb5e2d167c81b09e3c6bc35946f2eb5706818d045142';
const intSha='df7d672ed585349a06e6718429f5496978f1cf625eacd55a7fc6d7483a72edc4';
const intEtag='c48aec33b7d8ee274f0791af26661a78c8ef1758df9a98029f3e8d808a83d49a';
const sha=b=>createHash('sha256').update(b).digest('hex');
const hmac=(k,x)=>createHmac('sha256',k).update(x).digest();
const req=(x,err)=>assert.ok(x,err);
const cap=1024*1024;
const exactLength=x=>typeof x==='string'&&/^\d{1,16}$/.test(x)&&Number.isSafeInteger(Number(x))?Number(x):null;
const goodEtag=x=>typeof x==='string'&&/^"[^"\r\n]{1,128}"$/.test(x);

function classifyHead(r) {
 const length=exactLength(r.headers.get('content-length'));
 const raw=r.headers.get('content-encoding'), etag=r.headers.get('etag');
 const encoding=raw===null?'absent':raw.toLowerCase()==='identity'?'identity':raw.toLowerCase()==='gzip'?'gzip':'other';
 const eligibility=r.status!==200?'http_status':
   length===null?'length_missing_or_unparseable':length===0?'empty':
   encoding!=='absent'?'content_encoding_present':length>cap?'above_prior_1MiB_cap':
   !goodEtag(etag)?'etag_missing_or_invalid':'meets_previous_header_gate_only';
 return {status:r.status,contentLengthBytes:length,encoding,etagPresent:etag!==null,etagStrongShape:goodEtag(etag),
   abovePriorCap:length===null?null:length>cap,priorGetGateDiscriminator:eligibility,responseBodyRead:false};
}

export function signOne({fetcher=fetch,env=process.env,clock=Date.now}={}) {
 const allowed=new Map([...Object.values(paths).map(k=>[k,'GET']),[root,'HEAD']]);
 let calls=0,bytes=0;
 const seen=new Set(), deadline=clock()+40000;
 return Object.freeze({
  stats:()=>({requests:calls,controlBodyBytes:bytes,projectionBodyBytes:0}),
  async request(method,key){
    req(allowed.get(key)===method&&!seen.has(key)&&calls<4,'storage_scope_or_repeated_request');
    req(clock()<deadline,'time_bound');
    const access=env.YC_OBJECT_STORAGE_ACCESS_KEY_ID,secret=env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY;
    req(access&&secret,'signing_unavailable');
    seen.add(key); calls++;
    const time=new Date(clock()).toISOString().replace(/[:-]|\.\d{3}/g,''),day=time.slice(0,8);
    const keyScope=day+'/us-east-1/s3/aws4_request',pathname=prefix+key;
    const payload=sha(''),headers={host,'x-amz-content-sha256':payload,'x-amz-date':time};
    const names=Object.keys(headers).sort(),signed=names.join(';');
    const canonical=[method,pathname,'',names.map(n=>n+':'+headers[n]+'\n').join(''),signed,payload].join('\n');
    const signing=hmac(hmac(hmac(hmac('AWS4'+secret,day),'us-east-1'),'s3'),'aws4_request');
    headers.authorization='AWS4-HMAC-SHA256 Credential='+access+'/'+keyScope+', SignedHeaders='+signed+', Signature='+
      createHmac('sha256',signing).update(['AWS4-HMAC-SHA256',time,keyScope,sha(canonical)].join('\n')).digest('hex');
    const r=await fetcher('https://'+host+pathname,{method,headers,redirect:'error',signal:AbortSignal.timeout(Math.min(10000,deadline-clock()))});
    if(method==='HEAD'){
      const result=classifyHead(r); await r.body?.cancel();return result;
    }
    const n=exactLength(r.headers.get('content-length')), tag=r.headers.get('etag');
    req(r.status===200&&!r.headers.get('content-encoding')&&n>0&&n<=cap&&goodEtag(tag),'control_response_bound');
    const chunks=[];let c=0;
    for await(const b of r.body){c+=b.length;bytes+=b.length;req(c<=cap&&bytes<=3*cap,'control_body_bound');chunks.push(b);}
    req(c===n,'control_response_length');
    const body=Buffer.concat(chunks,c);
    return {sha:sha(body),etagSha:sha(tag),value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body))};
  }
 });
}
function verifyControls(p,i,l,now){
 req(p?.sha===pubSha&&p.etagSha===pubEtag&&p.value?.version===2&&p.value.generationId===gen&&
     p.value.markets?.europe?.count===38964&&p.value.markets.europe.chunks.length===78,'public_baseline_moved');
 req(i?.sha===intSha&&i.etagSha===intEtag&&i.value?.generationId==='gen_1795145660283_bbfbf3d1','internal_baseline_moved');
 const until=l?.value?.lockedUntil;
 req(until===''||(typeof until==='string'&&Number.isFinite(Date.parse(until))&&Date.parse(until)<=now),'writer_exclusion_unproved');
}
export async function diagnose({reader,clock=Date.now,verify=verifyControls}){
 // Exactly three current controls preceding the one-object metadata request.
 // A four-read cap intentionally precludes a second snapshot/settlement proof.
 const control=await Promise.all(Object.values(paths).map(key=>reader.request('GET',key)));
 verify(...control,clock());
 const projection=await reader.request('HEAD',root);
 return {priorRun:44767307086,generation:gen,controlPointersMatchedBeforeHead:true,
   projection,reads:reader.stats(),stablePairAfterHeadProven:false,
   readyToActivate:false,storageWrites:0,providerCalls:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const reader=signOne();
 try{console.log(JSON.stringify(await diagnose({reader})));}
 catch(e){const reason=typeof e.message==='string'&&/^[a-z_]{1,100}$/.test(e.message)?e.message:'bounded_read_failed';
   console.error(JSON.stringify({status:'held',reason,reads:reader.stats(),readyToActivate:false,storageWrites:0,providerCalls:0}));
   process.exitCode=2;
 }
}
