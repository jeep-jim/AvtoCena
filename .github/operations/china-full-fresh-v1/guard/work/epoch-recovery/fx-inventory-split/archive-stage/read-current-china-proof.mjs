/** Fixed-origin signed GETs for same-job continuity only, called by authorized successor. */
import {createHash,createHmac} from 'node:crypto';
import {expected,isBoundChinaContinuity} from './bind-converted-continuity.mjs';
const chars=/^[a-zA-Z0-9_+=./-]{1,256}$/, H=1024**2;
const sha=b=>createHash('sha256').update(b).digest('hex'),hmac=(k,b)=>createHmac('sha256',k).update(b).digest();
const must=(ok,k)=>{if(!ok)throw Error('china_continuity_read_'+k);};
const paths=Object.freeze({public:'catalog/manifest.json',internal:'catalog/internal/manifest.json',lease:'catalog/import-lock.json',appliedCursor:'catalog/intake-cursors/v1/china.json',controls:'catalog/operations/collection-controls-v1.json'});
export function createChinaContinuitySnapshotReader({access,secret,fetchImpl=globalThis.fetch,now=Date.now,pins=expected}){
 must(typeof access==='string'&&chars.test(access)&&typeof secret==='string'&&secret.length>0&&secret.length<=1024&&!/[\r\n\x00]/.test(secret),'credential');
 const expiry=Date.parse(pins.sourceAt)+48*3600000,allow=new Map([[paths.public,4*H],[paths.internal,4*H],[paths.lease,64*1024],[paths.appliedCursor,256*1024],[paths.controls,256*1024]]);
 let replicaPath=null,candidatePath=null;
 async function get(key){
  const e=now(),cap=allow.get(key);must(e>=Date.parse(pins.sourceAt)&&e<expiry&&cap,'scope');
  const host='s3.regru.cloud',p='/avtocena-staging-8120751/migration-staging/full-20261011/'+key,t=new Date(e).toISOString().replace(/[:-]|\.\d{3}/g,''),day=t.slice(0,8),scope=day+'/us-east-1/s3/aws4_request';
  const headers={host,'x-amz-content-sha256':sha(''),'x-amz-date':t},names=Object.keys(headers).sort();
  const request=['GET',p,'',names.map(k=>k+':'+headers[k]+'\n').join(''),names.join(';'),sha('')].join('\n'),sign=hmac(hmac(hmac(hmac('AWS4'+secret,day),'us-east-1'),'s3'),'aws4_request');
  headers.authorization='AWS4-HMAC-SHA256 Credential='+access+'/'+scope+', SignedHeaders='+names.join(';')+', Signature='+createHmac('sha256',sign).update(['AWS4-HMAC-SHA256',t,scope,sha(request)].join('\n')).digest('hex');
  const r=await fetchImpl('https://'+host+p,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(Math.min(20000,expiry-e))});
  if(key===paths.lease&&r.status===404){await r.body?.cancel();return null;}
  const length=r.headers.get('content-length'),etag=r.headers.get('etag'),n=Number(length);
  if(r.status!==200||!/^\d+$/.test(length||'')||n<=0||n>cap||!/^"[^"\r\n]{1,128}"$/.test(etag||'')||r.headers.get('content-encoding')){await r.body?.cancel();throw Error('china_continuity_read_response');}
  const body=Buffer.alloc(n);let offset=0;
  for await(const chunk of r.body){must(offset+chunk.length<=n,'cap');body.set(chunk,offset);offset+=chunk.length;}
  must(offset===n&&now()<expiry,'changed');
  return {body,etag,value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body))};
 }
 const snapshot=async()=>{
  const [pub,int,cursor,lease,controls]=await Promise.all([paths.public,paths.internal,paths.appliedCursor,paths.lease,paths.controls].map(get));
  must(sha(pub.body)===pins.publicSha&&pub.value?.generationId===pins.publicGeneration&&sha(int.body)===pins.internalSha&&int.value?.generationId===pins.internalGeneration&&
    sha(cursor.body)===pins.appliedCursorSha&&cursor.etag===pins.appliedCursorETag&&cursor.value?.generationId===pins.appliedCursorGeneration,'fixed_baseline');
  must(lease===null||lease.value?.lockedUntil===''||Number.isFinite(Date.parse(lease.value?.lockedUntil))&&Date.parse(lease.value.lockedUntil)<=now(),'lease_active');
  const c=controls.value;must(c?.version===1&&c.markets?.china?.enabled===true&&c.sources?.che168_feed?.enabled===true&&c.sources?.ajes_china_feed?.enabled===false,'owner_controls');
  const s=cursor.value?.sources?.filter(x=>x.provider==='auto_api_che168')??[];
  must(s.length===1&&s[0].cursor===pins.appliedCursor&&/^catalog\/provider-replicas\/che168\/[a-f0-9-]{36}$/.test(s[0].replica?.key||'')&&/^[a-f0-9]{64}$/.test(s[0].replica?.sha256||''),'replica_anchor');
  const next=s[0].replica.key+'/manifest.json';must(replicaPath===null||next===replicaPath,'replica_scope');replicaPath=next;allow.set(next,2*H);
  const r=await get(replicaPath);must(sha(JSON.stringify(r.value))===s[0].replica.sha256&&r.value?.cursor===s[0].cursor,'replica_digest');
  return {public:pub,internal:int,appliedCursor:cursor,lease:lease?.value??null,controls:c,appliedReplica:{key:replicaPath,value:r.value}};
 };
 return Object.assign(snapshot,{async verifyCandidateReplica(continuity){
  must(isBoundChinaContinuity(continuity),'candidate_owner');const expect=continuity.result.candidate,report=JSON.parse(await continuity.readReport());
  const candidates=report.sources?.filter(x=>x.provider==='auto_api_che168');const replica=candidates?.[0]?.replica;
  must(candidates?.length===1&&report.completed===true&&replica?.cursor===expect.cursor&&replica?.sha256===expect.replicaSha256&&
   replica.binding===continuity.result.applied.snapshotBinding&&/^catalog\/provider-replicas\/che168\/[a-f0-9-]{36}$/.test(replica.key||''),'candidate_ref');
  const key=replica.key+'/manifest.json';must(key!==replicaPath&&(candidatePath===null||candidatePath===key),'candidate_scope');
  candidatePath=key;allow.set(key,2*H);
  const m=(await get(key)).value;
  must(m?.version===1&&m.cursor===expect.cursor&&m.binding===replica.binding&&sha(JSON.stringify(m))===expect.replicaSha256&&
   Array.isArray(m.parts)&&m.parts.length>0&&m.parts.length<=1024&&Number.isSafeInteger(m.bytes)&&m.bytes>0,'candidate_manifest');
  let bytes=0;for(const x of m.parts){must(Number.isSafeInteger(x?.bytes)&&x.bytes>0&&x.bytes<=16*H&&/^[a-f0-9]{64}$/.test(x.sha256||''),'candidate_part_descriptors');bytes+=x.bytes;}
  must(bytes===m.bytes,'candidate_census');
  return Object.freeze({cursor:m.cursor,manifestSha256:expect.replicaSha256,bytes,parts:m.parts.length,binaryPartsDownloaded:0});
 }});

}
