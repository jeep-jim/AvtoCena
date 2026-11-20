import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { publicEvidence } from './public-reverse-membership.mjs';

// Exact same read-only role + namespace as 44765774453; no generic data client.
const g='gen_1794878284419_a611dfcf', host='s3.regru.cloud';
const fixedPrefix='/avtocena-staging-8120751/migration-staging/full-20261011/';
const pkey='catalog/manifest.json', ikey='catalog/internal/manifest.json', lkey='catalog/import-lock.json';
const imm='catalog/generations/'+g+'/indexes/projection/europe.json';
const cur='catalog/public/projection/europe.json';
const expected=Object.freeze({publicSha:'4c34c20d9784b571414390cab450ceeeaee60b00c168476100419ec5c05cb038',
  publicEtagSha:'426ac1af32eb10b21d3beb5e2d167c81b09e3c6bc35946f2eb5706818d045142',
  internal:'gen_1795145660283_bbfbf3d1',internalSha:'df7d672ed585349a06e6718429f5496978f1cf625eacd55a7fc6d7483a72edc4',
  internalEtagSha:'c48aec33b7d8ee274f0791af26661a78c8ef1758df9a98029f3e8d808a83d49a',
  mobileSha:'bd4ebed7818cc38287cd28bace5f4cd2b041ed850ae8cdce840a2e3b5006b718',
  protectedSourcesSha:'8f89b57ef2d37ff4106c7ed498740409c536a0c9a402df935b6e60ec6955dab2'});
const sha=b=>createHash('sha256').update(b).digest('hex');
const hash=x=>sha(JSON.stringify(x));
const hmac=(key,s)=>createHmac('sha256',key).update(s).digest();
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const small=1024**2, partCap=4*small, totalCap=128*small, maxGets=75;
const decode=b=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));
const req=(x,code)=>assert.ok(x,code);
const same=(a,b)=>a&&b&&a.digest===b.digest&&a.etagDigest===b.etagDigest;
export const scope=Object.freeze({pkey,ikey,lkey,imm,cur,g,fixedPrefix,expected});

export function signedReader({fetcher=fetch,env=process.env,clock=Date.now}={}){
 const allow=new Map([pkey,ikey,lkey,imm,cur].map(key=>[key,small]));
 const deadline=clock()+155000;
 let gets=0, wire=0, partsAllowed=false;
 return Object.freeze({
  stats:()=>({requests:gets,bytes:wire}),
  authorizeExactParts(key,doc){
   req(!partsAllowed&&(key===imm||key===cur),'projection_root_scope');
   req(doc?.storageFormat==='catalog-projection-parts-v1'&&doc.generationId===g&&doc.count===38964&&
     Array.isArray(doc.parts)&&doc.parts.length>=39&&doc.parts.length<=64,'directory_format_or_bounds');
   const base='catalog/generations/'+g+'/indexes/projection-parts/'+sha(key)+'/';
   let count=0;
   for(const [i,x] of doc.parts.entries()){
     req(hex(x?.sha256)&&x.path===base+i+'-'+x.sha256+'.json'&&Number.isSafeInteger(x.count)&&x.count>0&&x.count<=1000,'directory_scope_mismatch');
     count+=x.count;allow.set(x.path,partCap);
   }
   req(count===doc.count,'directory_count_mismatch');
   partsAllowed=true;
  },
  async get(key){
   req(allow.has(key),'unapproved_storage_key');
   req(clock()<deadline&&gets<maxGets,'request_deadline_or_cap');
   const access=env.YC_OBJECT_STORAGE_ACCESS_KEY_ID,secret=env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY;
   req(access&&secret,'signing_unavailable');
   ++gets;
   const ts=new Date(clock()).toISOString().replace(/[:-]|\.\d{3}/g,''),day=ts.slice(0,8);
   const pathname=fixedPrefix+key,sigScope=day+'/us-east-1/s3/aws4_request';
   const empty=sha(''),headers={host,'x-amz-content-sha256':empty,'x-amz-date':ts};
   const names=Object.keys(headers).sort(),signed=names.join(';');
   const request=['GET',pathname,'',names.map(n=>n+':'+headers[n]+'\n').join(''),signed,empty].join('\n');
   const signing=hmac(hmac(hmac(hmac('AWS4'+secret,day),'us-east-1'),'s3'),'aws4_request');
   headers.authorization='AWS4-HMAC-SHA256 Credential='+access+'/'+sigScope+', SignedHeaders='+signed+', Signature='+
     createHmac('sha256',signing).update(['AWS4-HMAC-SHA256',ts,sigScope,sha(request)].join('\n')).digest('hex');
   const result=await fetcher('https://'+host+pathname,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(Math.min(12000,deadline-clock()))});
   if(result.status===404){await result.body?.cancel();return null;}
   const cap=allow.get(key), n=result.headers.get('content-length'), etag=result.headers.get('etag');
   req(result.status===200&&!result.headers.get('content-encoding')&&/^\d+$/.test(n||'')&&Number(n)>0&&
     Number(n)<=cap&&totalCap-wire>=Number(n)&&/^"[^"\r\n]{1,128}"$/.test(etag||''),'unexpected_http_or_bounded_size');
   const parts=[];let matched=0;
   for await(const b of result.body){matched+=b.length;wire+=b.length;req(matched<=cap&&wire<=totalCap,'byte_budget_exceeded');parts.push(b);}
   req(matched===Number(n),'wire_length_mismatch');
   const bytes=Buffer.concat(parts,matched);
   return {bytes,digest:sha(bytes),etagDigest:sha(etag)};
  },
 });
}

function checkState(p,i,l,clock){
 const pv=p&&decode(p.bytes),iv=i&&decode(i.bytes),lv=l&&decode(l.bytes);
 req(p?.digest===expected.publicSha&&p.etagDigest===expected.publicEtagSha&&
  pv?.version===2&&pv.generationId===g&&pv.markets?.europe?.count===38964&&pv.markets.europe.chunks?.length===78,'public_cut_moved');
 req(i?.digest===expected.internalSha&&i.etagDigest===expected.internalEtagSha&&iv?.generationId===expected.internal&&iv.sources&&
  iv.sources.mobile_de_open?.count===6630&&hash(iv.sources.mobile_de_open)===expected.mobileSha&&
  hash(Object.entries(iv.sources).filter(([id])=>id!=='autoscout_europe_open').sort(([a],[b])=>a.localeCompare(b)))===expected.protectedSourcesSha,
  'internal_or_mobile_changed');
 req(lv?.lockedUntil===''||(typeof lv?.lockedUntil==='string'&&Number.isFinite(Date.parse(lv.lockedUntil))&&Date.parse(lv.lockedUntil)<=clock()),'writer_exclusion_unproved');
}

export async function inspectProjection({reader,clock=Date.now,check=checkState,validate=publicEvidence}){
 // Test injections are local imports only. CLI supplies neither.
 const before=await Promise.all([pkey,ikey,lkey].map(key=>reader.get(key)));
 check(...before,clock);
 let key=imm,root=await reader.get(key);
 if(root===null){key=cur;root=await reader.get(key);}
 req(root,'no_native_europe_projection');
 const doc=decode(root.bytes);
 reader.authorizeExactParts(key,doc); // Validates every complete directory descriptor BEFORE any part I/O.
 const views=await validate({capture:{generation:g,
  publicManifestBeforeSha:before[0].digest,publicManifestAfterSha:before[0].digest,
  publicEtagBeforeSha:before[0].etagDigest,publicEtagAfterSha:before[0].etagDigest,
  projectionKey:key,projectionRootBeforeSha:root.digest,projectionRootAfterSha:root.digest},
  rootBytes:root.bytes,getPart:async k=>{const x=await reader.get(k); req(x,'projection_part_missing');return x.bytes;}});
 const [p2,i2,l2,root2]=await Promise.all([pkey,ikey,lkey,key].map(k=>reader.get(k)));
 check(p2,i2,l2,clock);
 req(same(p2,before[0])&&same(i2,before[1])&&same(l2,before[2])&&same(root2,root),'probe_drift');
 return {priorStageSourceReadback:44765774453,stable:true,sourcePartProof:views,
  protectedMobileInternalDescriptorSha256:expected.mobileSha,protectedInternalSourcesSha256:expected.protectedSourcesSha,
  fullCardPayloadReconciliation:false,internalSettlementProven:false,readyToActivate:false,
  readCounts:reader.stats(),storageWrites:0,providerCalls:0};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 const reader=signedReader();
 try{ console.log(JSON.stringify(await inspectProjection({reader}))); }
 catch(e){
   const reason=typeof e.message==='string'&&/^[a-z_]{1,100}$/.test(e.message)?e.message:'bounded_read_failed';
   console.error(JSON.stringify({status:'held',reason,readCounts:reader.stats(),readyToActivate:false,storageWrites:0,providerCalls:0}));
   process.exitCode=2;
 }
}
