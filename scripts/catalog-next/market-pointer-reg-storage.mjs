/**
 * Narrow REG S3 adapter for per-market accepted data pointers.
 * No list, delete, upload of source records, cross-market writes or Docker.
 *
 * This does not activate the reader by itself. Call assertPrivateBucket before
 * read/compareAndSwap; use market-data-pointer.mjs for acceptance and rollback.
 */
import {createHash} from 'node:crypto';
import {signRawGcS3Request} from '../lib/catalog-raw-gc-s3.mjs';
import {privateOwnerAcl,nonGrantingPolicy} from './private-storage.mjs';
import {marketPointerPath,validateMarketPointer} from './market-data-pointer.mjs';

const MAX_BYTES=32*1024;
const fail=code=>{throw Error('market_pointer_storage_'+code)};
const need=(x,code)=>{if(!x)fail(code)};
const ordered=x=>Array.isArray(x)?x.map(ordered):x!==null&&typeof x==='object'
  ?Object.fromEntries(Object.keys(x).sort().map(k=>[k,ordered(x[k])])):x;
const encode=x=>Buffer.from(JSON.stringify(ordered(x)));
const sha=x=>createHash('sha256').update(x).digest('hex');
const ETAG=/^"[^"\x00-\x20\x7f]{1,250}"$/;

export function createRegMarketPointerStorage({environment=process.env,fetcher=fetch}={}){
  const configuration={YC_OBJECT_STORAGE_ENDPOINT:'https://s3.regru.cloud',YC_OBJECT_STORAGE_REGION:'us-east-1',
    YC_OBJECT_STORAGE_BUCKET:'avtocena-staging-8120751',
    YC_OBJECT_STORAGE_PREFIX:'migration-staging/full-20261011/'};
  for(const [k,v] of Object.entries(configuration))need(environment[k]===v,'configuration');
  const accessKeyId=environment.YC_OBJECT_STORAGE_ACCESS_KEY_ID;
  const secretAccessKey=environment.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY;
  need(typeof accessKeyId==='string' && /^[A-Za-z0-9_+=./-]{1,256}$/.test(accessKeyId) &&
    typeof secretAccessKey==='string' && secretAccessKey.length>0 && secretAccessKey.length<=1024 &&
    !/[\r\n\x00]/.test(secretAccessKey),'credentials');
  need(typeof fetcher==='function','fetcher');
  let privacy=null;

  async function request(method,market=null,query={},body,headers={}){
    need(['GET','PUT'].includes(method),'method');
    const key=market===null?'':marketPointerPath(market);
    const target='/avtocena-staging-8120751'+(market===null?'':'/migration-staging/full-20261011/'+key);
    const signed=signRawGcS3Request({method,host:'s3.regru.cloud',path:target,query,
      body:body??'',headers,region:'us-east-1',accessKeyId,secretAccessKey,at:Date.now()});
    let response;
    try{
      response=await fetcher('https://s3.regru.cloud'+signed.canonicalPath+
        (signed.canonicalQuery?'?'+signed.canonicalQuery:''),
        {method,headers:signed.headers,body,redirect:'error',signal:AbortSignal.timeout(30000)});
    }catch{fail('transport')}
    const chunks=[];let total=0;
    try{for await(const chunk of response.body??[]){
      total+=chunk.byteLength;need(total<=MAX_BYTES,'response_size');chunks.push(Buffer.from(chunk));
    }}catch{fail('response_incomplete')}
    return {status:response.status,body:Buffer.concat(chunks,total),etag:response.headers.get('etag')};
  }

  async function assertPrivateBucket(){
    const acl=await request('GET',null,{acl:''});need(acl.status===200,'bucket_acl');
    const owner=privateOwnerAcl(acl.body.toString());
    const policy=await request('GET',null,{policy:''});
    const next={owner,policySha256:nonGrantingPolicy(policy.status,policy.body.toString())};
    if(privacy)need(JSON.stringify(privacy)===JSON.stringify(next),'privacy_changed');
    else privacy=next;
    return {verified:true};
  }

  async function read(market){
    need(privacy,'privacy_not_checked');marketPointerPath(market);
    const acl=await request('GET',market,{acl:''});
    if(acl.status===404){
      const missing=await request('GET',market);need(missing.status===404,'missing_changed');
      return {etag:null,value:null};
    }
    need(acl.status===200 && privateOwnerAcl(acl.body.toString())===privacy.owner,'object_acl');
    const result=await request('GET',market);need(result.status===200 && ETAG.test(result.etag||''),'read');
    let doc;try{doc=JSON.parse(result.body.toString('utf8'));}catch{fail('document_json')}
    validateMarketPointer(market,doc);
    need(result.body.equals(encode(doc)),'noncanonical_document');
    return {etag:result.etag,value:doc};
  }
  async function compareAndSwap(market,expectedEtag,next){
    need(privacy,'privacy_not_checked');marketPointerPath(market);validateMarketPointer(market,next);
    need(expectedEtag===null||ETAG.test(expectedEtag),'expected_etag');
    const body=encode(next);need(body.length>0 && body.length<=MAX_BYTES,'document_size');
    const condition=expectedEtag===null?{'if-none-match':'*'}:{'if-match':expectedEtag.slice(1,-1)};
    const response=await request('PUT',market,{},body,{
      'content-type':'application/json','x-amz-acl':'private',...condition});
    if([409,412].includes(response.status))fail('conflict');
    need([200,201].includes(response.status),'write_failed');
  }
  return Object.freeze({assertPrivateBucket,read,compareAndSwap});
}
