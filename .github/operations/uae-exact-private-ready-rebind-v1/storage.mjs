import {createHmac,createHash} from 'node:crypto';
import {REAL,prefix,sha} from './repair.mjs';
const scope=Object.freeze({origin:'https://s3.regru.cloud',bucket:'avtocena-staging-8120751',prefix:'migration-staging/full-20261011',region:'us-east-1'});
const req=(ok,code)=>{if(!ok)throw Error('uae_rebind:'+code);};
const hmac=(key,s)=>createHmac('sha256',key).update(s).digest();
const empty=sha(Buffer.alloc(0));
const XML_MAX=64*1024;
const names=/^(?:projection\/\d{1,3}\.json|details\/[a-f0-9]{2}\.json|(?:READY|retained-evidence|input-evidence|public-directory)\.json)$/;
const fixed=new Set([REAL.sourceKey,REAL.priceKey,'catalog/manifest.json','catalog/intake-cursors/v1/uae.json',
 'catalog-editorial/current.json','catalog/independent-market-public-v1/uae/control.json']);
const ownerOnly=(text)=>{
 const clean=text.trim().replace(/^<\?xml version="1\.0"(?: encoding="(?:UTF-8|utf-8)")?\?>\s*/,'').replace(/>\s+</g,'><');
 const fields='<ID>([A-Za-z0-9_.:@-]{1,256})<\\/ID>(?:<DisplayName>[^<&]*<\\/DisplayName>)?';
 const r=new RegExp('^<AccessControlPolicy(?: xmlns="http://s3\\.amazonaws\\.com/doc/2006-03-01/")?><Owner>'+fields+
  '</Owner><AccessControlList><Grant><Grantee xmlns:xsi="http://www\\.w3\\.org/2001/XMLSchema-instance" xsi:type="CanonicalUser">'+fields+
  '</Grantee><Permission>FULL_CONTROL</Permission></Grant></AccessControlList></AccessControlPolicy>$');
 const m=r.exec(clean);req(m&&m[1]===m[2],'owner_only_acl_required');return m[1];
};
const statusPolicy=(s,body)=>s===404&&/^\s*(?:<\?xml version="1\.0"(?: encoding="(?:UTF-8|utf-8)")?\?>\s*)?<Error>\s*<Code>NoSuchBucketPolicy<\/Code>[\s\S]*<\/Error>\s*$/.test(body);
const encode=s=>encodeURIComponent(s).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
export function makeUaeRebindStorage({runId,access,secret,mode,fetcher=globalThis.fetch,now=Date.now}){
 req(/^[1-9]\d{8,14}$/.test(runId)&&runId!==REAL.runId&&typeof access==='string'&&access.length>0&&typeof secret==='string'&&secret.length>0&&
  ['proof','rebind'].includes(mode),'scope');
 const src=prefix(REAL.runId),dest=prefix(runId);
 const readOld=k=>fixed.has(k)||(k.startsWith(src)&&names.test(k.slice(src.length)));
 const ourObject=k=>k.startsWith(dest)&&names.test(k.slice(dest.length));
 let reads=0,puts=0,received=0,sent=0;
 let allowed=false;
 const keyCap=key=>key==='catalog-editorial/current.json'?8*1024*1024:4*1024*1024;
 async function responseBytes(r,cap){
  if(!r.body)return Buffer.alloc(0);
  const size=Number(r.headers.get('content-length')??0);req(!size||size<=cap,'response_bound');
  const reader=r.body.getReader(),chunks=[];let count=0;
  try{for(;;){const x=await reader.read();if(x.done)break;count+=x.value.byteLength;received+=x.value.byteLength;
   if(count>cap||received>400*1024*1024){await reader.cancel();throw Error('uae_rebind:response_bound');}chunks.push(x.value);
  }} finally{reader.releaseLock();}
  return Buffer.concat(chunks,count);
 }
 async function call(method,key,kind,cap,body){
  if(key===null)req(method==='GET'&&['acl','policy'].includes(kind),'bucket_read_only');
  else if(method==='PUT'){
   req(allowed&&mode==='rebind'&&ourObject(key)&&!kind&&Buffer.isBuffer(body)&&body.length>0&&body.length<=4*1024*1024&&
       ++puts<=364&&(sent+=body.length)<=160*1024*1024,'write_scope');
  } else req(method==='GET'&&(readOld(key)||(allowed&&ourObject(key)))&&(!kind||kind==='acl'&&allowed&&ourObject(key))&&++reads<=1150,'read_scope');
  const url = new URL(scope.origin+'/'+scope.bucket+(key?'/'+(scope.prefix+'/'+key).split('/').map(encode).join('/'):''));
  const query=kind?kind+'=':'';url.search=query;
  const stamped=new Date(now()).toISOString().replace(/[:-]|\.\d{3}/g,''),date=stamped.slice(0,8),signedScope=date+'/'+scope.region+'/s3/aws4_request';
  const headers={host:url.host,'x-amz-content-sha256':body?sha(body):empty,'x-amz-date':stamped,
    ...(body?{'content-type':'application/json','if-none-match':'*','x-amz-acl':'private'}:{})};
  const sorted=Object.keys(headers).sort(),signed=sorted.join(';');
  const canonical=[method,url.pathname,query,sorted.map(k=>k+':'+headers[k]+'\n').join(''),signed,headers['x-amz-content-sha256']].join('\n');
  const keyBytes=hmac(hmac(hmac(hmac('AWS4'+secret,date),scope.region),'s3'),'aws4_request');
  headers.authorization='AWS4-HMAC-SHA256 Credential='+access+'/'+signedScope+', SignedHeaders='+signed+
    ', Signature='+createHmac('sha256',keyBytes).update(['AWS4-HMAC-SHA256',stamped,signedScope,sha(canonical)].join('\n')).digest('hex');
  const r=await fetcher(url,{method,headers,body,redirect:'error',signal:AbortSignal.timeout(25000)});
  if(r.status===200||r.status===404)return {status:r.status,b:await responseBytes(r,r.status===404?XML_MAX:cap),etag:r.headers.get('etag')};
  await r.body?.cancel();
  return {status:r.status,b:Buffer.alloc(0),etag:r.headers.get('etag')};
 }
 async function permission(){
  const [a,p]=await Promise.all([call('GET',null,'acl',XML_MAX),call('GET',null,'policy',XML_MAX)]);
  req(a.status===200,'bucket_acl_'+a.status);req(statusPolicy(p.status,p.b.toString()),'bucket_policy_unverified_'+p.status);
  const owner=ownerOnly(a.b.toString());
  return {owner,ownerDigest:createHash('sha256').update(owner).digest('hex'),policy:'verified_absent_bucket_policy'};
 }
 async function get(key,cap){
  req(Number.isSafeInteger(cap)&&cap>0&&cap<=keyCap(key),'read_limit');
  const r=await call('GET',key,null,cap);
  if(r.status!==200)throw Error('s3_read_'+r.status);
  req(r.b.length>0,'empty_object');
  return r.b;
 }
 return Object.freeze({
  get, permission, async controlAbsent(){return (await call('GET','catalog/independent-market-public-v1/uae/control.json',null,32768)).status===404;},
  openPrivateOnlyCapability({gateSha,expectedGateSha,privacy}){
   req(mode==='rebind'&&/^[a-f0-9]{64}$/.test(gateSha)&&gateSha===expectedGateSha&&privacy?.policy==='verified_absent_bucket_policy','fresh_proof_required');
   allowed=true;
   return Object.freeze({scope:'uae-createonly-rebind-private-v1',prefix:dest,
    async assertAuthorization(){const p=await permission();req(p.owner===privacy.owner&&p.policy===privacy.policy,'privacy_changed');},
    async createOnly(key,b,c){req(c?.ifNoneMatch==='*','require_if_none_match');const r=await call('PUT',key,null,XML_MAX,b);
     if(r.status===200||r.status===201)return 'created';
     if(r.status===409||r.status===412)return 'already-exact-check-required';
     throw Error('uae_rebind:private_create_'+r.status);
    },
    async readPrivateSameOwner(key,cap){const a=await call('GET',key,'acl',XML_MAX);
     req(a.status===200&&ownerOnly(a.b.toString())===privacy.owner,'object_acl_unverified_'+a.status);return get(key,cap);},
   });
  },
  totals:()=>({reads,privatePuts:puts,receivedBytes:received,sentBytes:sent}),
 });
}
