import assert from 'node:assert/strict';
import { createHash,createHmac } from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {streamNativeMembership} from './inline-stream.mjs';

// Evidence: exact HEAD-only run 44768118600; direct use always opt-in by root.
const g='gen_1794878284419_a611dfcf', bytesExpected=96505936, rowCount=38964;
const host='s3.regru.cloud', prefix='/avtocena-staging-8120751/migration-staging/full-20261011/';
const keys={p:'catalog/manifest.json',i:'catalog/internal/manifest.json',l:'catalog/import-lock.json'};
const root='catalog/generations/'+g+'/indexes/projection/europe.json';
const expected={pSha:'4c34c20d9784b571414390cab450ceeeaee60b00c168476100419ec5c05cb038',
 pEtag:'426ac1af32eb10b21d3beb5e2d167c81b09e3c6bc35946f2eb5706818d045142',
 iSha:'df7d672ed585349a06e6718429f5496978f1cf625eacd55a7fc6d7483a72edc4',
 iEtag:'c48aec33b7d8ee274f0791af26661a78c8ef1758df9a98029f3e8d808a83d49a',
 internal:'gen_1795145660283_bbfbf3d1',mobile:'bd4ebed7818cc38287cd28bace5f4cd2b041ed850ae8cdce840a2e3b5006b718',
 protectedSet:'8f89b57ef2d37ff4106c7ed498740409c536a0c9a402df935b6e60ec6955dab2'};
export const scope=Object.freeze({g,root,keys:Object.freeze(keys),host,prefix,bytesExpected,rowCount});
const sha=b=>createHash('sha256').update(b).digest('hex');
const hash=x=>sha(JSON.stringify(x)), hmac=(key,s)=>createHmac('sha256',key).update(s).digest();
const req=(x,code)=>assert.ok(x,code);
const length=x=>typeof x==='string'&&/^\d{1,16}$/.test(x)&&Number.isSafeInteger(Number(x))?Number(x):null;
const strong=tag=>typeof tag==='string'&&/^"[^"\r\n]{1,128}"$/.test(tag);
const cap=128*1024**2, small=1024**2;
const match=(a,b)=>a?.sha===b?.sha&&a?.etagSha===b?.etagSha;
const decode=b=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));

export function narrowReader({fetcher=fetch,env=process.env,clock=Date.now,fixtureWireBytes}={}){
 const exact=fixtureWireBytes??bytesExpected; // never read from hosted event/env
 req(Number.isSafeInteger(exact)&&exact>0&&exact+6*small<=cap,'fixed_wire_contract');
 const allowedControl=new Set(Object.values(keys)),seen=new Map();
 const deadline=clock()+155000;
 let reads=0,controlBytes=0,projectionBytes=0;
 let rootHeadTag=null,rootGets=0,heads=0;
 function checkRootResponse(r){
   const n=length(r.headers.get('content-length')),tag=r.headers.get('etag');
   req(r.status===200&&n===exact&&!r.headers.get('content-encoding')&&strong(tag),'root_header_outside_exact_head_contract');
   return tag;
 }
 async function signed(method,key,condition){
   req(allowedControl.has(key)&&method==='GET'&&!condition||key===root&&(method==='HEAD'&&!condition||method==='GET'&&condition===rootHeadTag&&strong(condition)),
      'unapproved_scope_or_verb');
   const tuple=method+'/'+key,k=seen.get(tuple)||0;
   req(k<(key===root&&method==='GET'?1:2)&&reads<9&&clock()<deadline,'probe_request_cap');
   seen.set(tuple,k+1);reads++;
   const access=env.YC_OBJECT_STORAGE_ACCESS_KEY_ID,secret=env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY;
   req(access&&secret,'signing_unavailable');
   const ts=new Date(clock()).toISOString().replace(/[:-]|\.\d{3}/g,''),day=ts.slice(0,8);
   const scope=day+'/us-east-1/s3/aws4_request',pathname=prefix+key;
   const empty=sha(''),headers={host,'x-amz-content-sha256':empty,'x-amz-date':ts};
   if(condition)headers['if-match']=condition;
   const names=Object.keys(headers).sort(),signed=names.join(';');
   const canonical=[method,pathname,'',names.map(n=>n+':'+headers[n]+'\n').join(''),signed,empty].join('\n');
   const signing=hmac(hmac(hmac(hmac('AWS4'+secret,day),'us-east-1'),'s3'),'aws4_request');
   headers.authorization='AWS4-HMAC-SHA256 Credential='+access+'/'+scope+', SignedHeaders='+signed+', Signature='+
    createHmac('sha256',signing).update(['AWS4-HMAC-SHA256',ts,scope,sha(canonical)].join('\n')).digest('hex');
   return fetcher('https://'+host+pathname,{method,headers,redirect:'error',
      signal:AbortSignal.timeout(Math.min(key===root&&method==='GET'?130000:12000,deadline-clock()))});
 }
 return Object.freeze({
   stats:()=>({reads,controlBytes,projectionBytes}),
   async control(key){
     req(allowedControl.has(key),'unapproved_control');
     const r=await signed('GET',key);
     const n=length(r.headers.get('content-length')),tag=r.headers.get('etag');
     req(r.status===200&&n>0&&n<=small&&strong(tag)&&!r.headers.get('content-encoding'),'control_header_bound');
     const parts=[]; let c=0;
     for await(const b of r.body){
       c+=b.byteLength;controlBytes+=b.byteLength;req(c<=small&&controlBytes<=6*small&&controlBytes+projectionBytes<=cap,'control_body_bound');
       parts.push(b);
     }
     req(n===c,'control_wire_mismatch');
     const body=Buffer.concat(parts,c);
     return {sha:sha(body),etagSha:sha(tag),value:decode(body)};
   },
   async rootHead(){
     req(heads===0&&rootGets===0||heads===1&&rootGets===1,'root_head_order');
     const r=await signed('HEAD',root);
     const tag=checkRootResponse(r);
     await r.body?.cancel();heads++;
     if(heads===1)rootHeadTag=tag;
     else req(tag===rootHeadTag,'root_etag_changed_after_stream');
     return sha(tag);
   },
   async rootBody(){
     req(heads===1&&rootGets===0&&strong(rootHeadTag),'root_get_order');
     rootGets++;
     const r=await signed('GET',root,rootHeadTag);
     req(checkRootResponse(r)===rootHeadTag,'root_etag_changed');
     req(/^application\/json(?:\s*;|$)/i.test(r.headers.get('content-type')||''),'root_is_not_native_json_mime');
     const stream=(async function*(){
       for await(const b of r.body){
         projectionBytes+=b.byteLength;
         req(projectionBytes<=exact&&projectionBytes+controlBytes<=cap,'projection_wire_bound');
         yield b;
       }
     })();
     return {stream,wireBytes:exact,deadline};
   },
 });
}
function verify(p,i,l,now){
 req(p?.sha===expected.pSha&&p.etagSha===expected.pEtag&&p.value?.version===2&&p.value?.generationId===g&&
     p.value.markets?.europe?.count===rowCount&&p.value.markets.europe.chunks?.length===78,'public_generation_drift');
 req(i?.sha===expected.iSha&&i.etagSha===expected.iEtag&&i.value?.generationId===expected.internal&&
     i.value?.sources?.mobile_de_open?.count===6630&&hash(i.value.sources.mobile_de_open)===expected.mobile&&
     hash(Object.entries(i.value.sources).filter(([id])=>id!=='autoscout_europe_open').sort(([a],[b])=>a.localeCompare(b)))===expected.protectedSet,
     'internal_source_descriptor_drift');
 const t=l?.value?.lockedUntil;
 req(t===''||(typeof t==='string'&&Number.isFinite(Date.parse(t))&&Date.parse(t)<=now),'writer_exclusion_unproved');
}
export async function inspect({reader,clock=Date.now,verifyControls=verify,fixtureRowCount}){
 const before=await Promise.all(Object.values(keys).map(k=>reader.control(k)));
 verifyControls(...before,clock());
 const h=await reader.rootHead();
 const body=await reader.rootBody();
 const evidence=await streamNativeMembership(body.stream,{wireBytes:body.wireBytes,deadline:body.deadline,
   generation:g,rowCount:fixtureRowCount??rowCount,clock});
 const h2=await reader.rootHead();
 const after=await Promise.all(Object.values(keys).map(k=>reader.control(k)));
 verifyControls(...after,clock());
 req(h===h2&&before.every((x,k)=>match(x,after[k])),'pointer_or_root_changed');
 return {headProofRun:44768118600,sourceArchiveProofRun:44765774453,pinnedPublicInternalAndRoot:true,
   rootEtagSha256:h2,evidence,internalMobileDescriptorSha256:expected.mobile,protectedInternalSourceSetSha256:expected.protectedSet,
   internalSettlementProven:false,fullCardPayloadReconciliation:false,readyToActivate:false,
   reads:reader.stats(),storageWrites:0,providerCalls:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const reader=narrowReader();
 try{console.log(JSON.stringify(await inspect({reader})));}
 catch(e){
   const reason=typeof e.message==='string'&&/^[a-z_]{1,100}$/.test(e.message)?e.message:'bounded_decode_or_read_failed';
   console.error(JSON.stringify({status:'held',reason,reads:reader.stats(),readyToActivate:false,storageWrites:0,providerCalls:0}));
   process.exitCode=2;
 }
}
