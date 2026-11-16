import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {signRawGcS3Request,parseRawGcS3List,parseRawGcS3Delete,createReadOnlyRawGcS3Transport,executeRawGcWithS3} from '../scripts/lib/catalog-raw-gc-s3.mjs';
import {RAW_GC_TARGET,RAW_GC_POLICY_KEY,prepareRawGcPlan,readRawGcAuthority} from '../scripts/lib/catalog-raw-gc.mjs';
import {RAW_PREFIXES,rawDigest,rawGenerationKey,buildRawGenerationProvenance} from '../scripts/lib/catalog-raw-provenance.mjs';
import {RAW_COORDINATION_KEY,RAW_COORDINATED_POINTERS,RAW_COORDINATED_WRITERS,createRawCoordination,rawPointerDescriptor,
  rawCatalogDescriptor,transitionRawCoordination} from '../scripts/lib/catalog-raw-coordination.mjs';
import {RAW_INTERNAL_COORDINATION_ID,RAW_INTERNAL_MANIFEST_KEY,rawInternalPointerDescriptor,
  rawInternalProvenanceKey,buildRawInternalProvenance} from '../apps/web/lib/catalog/raw-internal-provenance.mjs';
import {verifySourceContribution} from '../apps/web/lib/catalog/source-contribution-reader.mjs';
import {sourceContributionFixture} from './helpers/source-contribution-fixture.mjs';
import {runRawGcReadOnlyCli} from '../scripts/catalog-raw-gc-plan.mjs';

const env={YC_OBJECT_STORAGE_ENDPOINT:RAW_GC_TARGET.endpoint,YC_OBJECT_STORAGE_BUCKET:RAW_GC_TARGET.bucket,
  YC_OBJECT_STORAGE_PREFIX:RAW_GC_TARGET.prefix,YC_OBJECT_STORAGE_REGION:'us-east-1',
  YC_OBJECT_STORAGE_ACCESS_KEY_ID:'fixture-access',YC_OBJECT_STORAGE_SECRET_ACCESS_KEY:'fixture-secret-private',
  GITHUB_REPOSITORY:'jeep-jim/AvtoCena',GITHUB_REF:'refs/heads/main',GITHUB_RUN_ID:'43870000000',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:'a'.repeat(40)};
const target=RAW_GC_TARGET,root='catalog/provider-replicas/che168/00000000-0000-4000-8000-000000000001',prefix=root+'/',key=root+'/0.gz';
const stamp='2026-01-01T00:00:00.000Z',sha=n=>n.toString(16).padStart(64,'0');
const escape=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const metadata=(keyValue=key)=>({key:keyValue,size:4,lastModified:stamp,etag:'"etag-fixture"'});
const until=()=>Date.now()+1000;
function xmlList(rows,{prefix:rel=prefix,maxKeys=10,truncated=false,nextCursor,cursor=null}={}) {
  return '<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
    +'<Name>'+target.bucket+'</Name><Prefix>'+encodeURIComponent(target.prefix+rel)+'</Prefix><EncodingType>url</EncodingType>'
    +'<MaxKeys>'+maxKeys+'</MaxKeys><KeyCount>'+rows.length+'</KeyCount><IsTruncated>'+truncated+'</IsTruncated>'
    +(cursor===null?'':'<ContinuationToken>'+escape(cursor)+'</ContinuationToken>')
    +rows.map(row=>'<Contents><Key>'+encodeURIComponent(target.prefix+row.key)+'</Key><ETag>'+escape(row.etag)+'</ETag><Size>'+row.size+'</Size><LastModified>'+row.lastModified+'</LastModified><StorageClass>STANDARD</StorageClass></Contents>').join('')
    +(nextCursor===undefined?'':'<NextContinuationToken>'+escape(nextCursor)+'</NextContinuationToken>')+'</ListBucketResult>';
}
const jsonResponse=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{etag:'"json-fixture"','content-length':String(Buffer.byteLength(JSON.stringify(value)))}});
const transport=fetchImpl=>createReadOnlyRawGcS3Transport({environment:env,fetchImpl});

test('SigV4 matches the published AWS GET, PUT, lifecycle and list signature fixtures',()=>{
  // AWS primary fixtures: https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-header-based-auth.html
  const base={host:'examplebucket.s3.amazonaws.com',region:'us-east-1',accessKeyId:'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey:'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',at:Date.parse('2013-05-24T00:00:00Z')};
  const fixtures=[
    {method:'GET',path:'/test.txt',headers:{range:'bytes=0-9'},expected:'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'},
    {method:'PUT',path:'/test$file.text',body:'Welcome to Amazon S3.',headers:{date:'Fri, 24 May 2013 00:00:00 GMT','x-amz-storage-class':'REDUCED_REDUNDANCY'},expected:'98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd'},
    {method:'GET',path:'/',query:{lifecycle:''},expected:'fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543'},
    {method:'GET',path:'/',query:{prefix:'J','max-keys':'2'},expected:'34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7'}];
  for(const {expected,...value} of fixtures)assert.equal(signRawGcS3Request({...base,...value}).signature,expected);
});
test('canonical query encodes opaque values once and sorts encoded keys without path normalization',()=>{
  const value=signRawGcS3Request({method:'GET',host:'fixture.invalid',path:'/a b//c+$!(*)',query:{z:'a+b/c== &é',A:'',a:'/'},
    accessKeyId:'fixture',secretAccessKey:'fixture',region:'us-east-1',at:0});
  assert.equal(value.canonicalPath,'/a%20b//c%2B%24%21%28%2A%29');
  assert.equal(value.canonicalQuery,'A=&a=%2F&z=a%2Bb%2Fc%3D%3D%20%26%C3%A9');
});
test('read-only factory has no mutation method or configuration escape',()=>{
  const io=transport(async()=>{throw Error('must not request');});assert.equal(io.writeJson,undefined);assert.equal(io.deleteBatch,undefined);
  assert.throws(()=>createReadOnlyRawGcS3Transport({environment:env,execution:{}}),/readonly_factory/);
  for(const [field,value] of [['YC_OBJECT_STORAGE_ENDPOINT','https://other.invalid'],['YC_OBJECT_STORAGE_BUCKET','other'],
    ['YC_OBJECT_STORAGE_PREFIX','migration-staging/elsewhere/'],['YC_OBJECT_STORAGE_REGION','ru-central1']]){
    assert.throws(()=>createReadOnlyRawGcS3Transport({environment:{...env,[field]:value}}),/configuration/);
  }
});
test('GET uses only the pinned endpoint and relative allowlist; provider/customer keys never reach fetch',async()=>{
  const calls=[],io=transport(async(url,options)=>{calls.push({url,options});return jsonResponse({ok:true});});
  const value=await io.readJson({target,key:RAW_GC_POLICY_KEY,maxBytes:1024,deadline:until()});assert.equal(value.found,true);assert.equal(value.etag,'"json-fixture"');
  assert.equal(calls[0].url.origin,target.endpoint);assert.equal(calls[0].url.pathname,'/'+target.bucket+'/'+target.prefix+RAW_GC_POLICY_KEY);
  assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.method,'GET');assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(calls[0].options.headers['accept-encoding'],'identity');
  for(const unsafe of ['crm/clients.json','catalog/nonjp-intake/v1/japan/1/1/complete.json',target.prefix+RAW_GC_POLICY_KEY,'catalog/../policy.json',root+'/pages/1.json']){
    await assert.rejects(io.readJson({target,key:unsafe,maxBytes:1024,deadline:until()}));
  }
  await assert.rejects(io.readJson({target:{...target,bucket:'other'},key:RAW_GC_POLICY_KEY,maxBytes:1024,deadline:until()}),/target/);
  assert.equal(calls.length,1);
});
test('404 alone is absence; 403/500/503/redirect-like responses are never retried or logged verbatim',async()=>{
  for(const status of [404,403,500,503,307]){
    let calls=0;const io=transport(async()=>{calls++;return new Response('private-body-'+env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY,{status});});
    const read=io.readJson({target,key:RAW_GC_POLICY_KEY,maxBytes:1024,deadline:until()});
    if(status===404)assert.deepEqual(await read,{found:false,value:null});
    else await assert.rejects(read,error=>error.message==='raw_gc_s3_http_'+status&&!error.message.includes('private'));
    assert.equal(calls,1);
  }
});
test('LIST decodes entity and URL fields, carries an opaque continuation token once, and exposes bounded metadata',async()=>{
  const token='opaque+/== &quote"',calls=[],io=transport(async(url,options)=>{
    calls.push({url,options});return new Response(xmlList([metadata()],{maxKeys:2,cursor:token,truncated:true,nextCursor:'next+/' }));
  });
  const result=await io.listPage({target,prefix,cursor:token,maxKeys:2,deadline:until()});
  assert.deepEqual(result.objects,[metadata()]);assert.equal(result.nextCursor,'next+/');
  assert.equal(calls[0].url.searchParams.get('continuation-token'),token);assert.match(calls[0].url.search,/opaque%2B%2F%3D%3D%20%26quote%22/);
  assert.equal(calls[0].url.searchParams.get('max-keys'),'2');assert.equal(calls[0].url.searchParams.get('prefix'),target.prefix+prefix);
  assert.equal(calls[0].options.method,'GET');
});
test('malformed XML, entities, duplicated scalars, wrong prefixes and truncated page contracts fail closed',()=>{
  const good=xmlList([metadata()]);
  for(const broken of [good.slice(0,-20),good.replace('<IsTruncated>false</IsTruncated>','<IsTruncated>false</IsTruncated><IsTruncated>false</IsTruncated>'),
    good.replace('<Name>','<!DOCTYPE x SYSTEM "file:///etc/passwd"><Name>'),good.replace('etag-fixture','&unknown;'),
    good.replace('etag-fixture','&#0;'),good.replace('etag-fixture','&#xFFFF;'),good.replace('avtocena-staging-8120751','foreign-bucket'),
    good.replace('<KeyCount>1</KeyCount>','<KeyCount>2</KeyCount>'),good.replace('<IsTruncated>false</IsTruncated>','<IsTruncated>true</IsTruncated>'),
    good.replace('</ListBucketResult>','</ListBucketResult><trailing/>'),good.replace('<Size>4</Size>','<Size>-1</Size>')]){
    assert.throws(()=>parseRawGcS3List(broken,{prefix,maxKeys:10}),/raw_gc_s3_/);
  }
  assert.throws(()=>parseRawGcS3List(xmlList([metadata(),metadata()]),{prefix,maxKeys:10}),/list_count/);
  assert.throws(()=>parseRawGcS3List(xmlList([metadata('catalog/paid-encar-reports/v1/1/history/aa.json')]),{prefix,maxKeys:10}),/list_key_prefix/);
});
test('LIST pagination cannot scan a whole bucket, another market namespace, or exceed a page cap',async()=>{
  let calls=0;const io=transport(async()=>{calls++;return new Response('');});
  for(const value of [{prefix:''},{prefix:target.prefix},{prefix:'catalog/nonjp-intake/v1/japan/1/1/'},{maxKeys:1001},{cursor:''}]){
    await assert.rejects(io.listPage({target,prefix,maxKeys:10,cursor:null,deadline:until(),...value}));
  }
  assert.equal(calls,0);
});
test('HEAD and LIST return the same strong ETag, canonical timestamp and exact byte count',async()=>{
  const io=transport(async()=>new Response(null,{headers:{etag:'"etag-fixture"','last-modified':'Thu, 01 Jan 2026 00:00:00 GMT','content-length':'4'}}));
  assert.deepEqual(await io.headObject({target,key,deadline:until()}),{found:true,etag:'"etag-fixture"',lastModified:stamp,size:4});
  for(const headers of [{etag:'W/"etag-fixture"','last-modified':stamp,'content-length':'4'},
    {etag:'"etag-fixture"','last-modified':'invalid','content-length':'4'},
    {etag:'"etag-fixture"','last-modified':stamp,'content-length':'9007199254740992'}]){
    await assert.rejects(transport(async()=>new Response(null,{headers})).headObject({target,key,deadline:until()}),/raw_gc_s3_/);
  }
});
test('declared, streamed and aggregate response limits abort before parsing or another request',async()=>{
  for(const declared of [false,true]){
    let cancelled=false;const io=transport(async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{"large":true}'));},cancel(){cancelled=true;}}),
      {headers:{etag:'"fixture"',...(declared?{'content-length':'1000000'}:{})}}));
    await assert.rejects(io.readJson({target,key:RAW_GC_POLICY_KEY,maxBytes:4,deadline:until()}),/response_size/);assert.equal(cancelled,true);
  }
  const io=createReadOnlyRawGcS3Transport({environment:env,limits:{responseBytes:8},fetchImpl:async()=>jsonResponse({x:1})});
  await io.readJson({target,key:RAW_GC_POLICY_KEY,maxBytes:100,deadline:until()});
  await assert.rejects(io.readJson({target,key:RAW_GC_POLICY_KEY,maxBytes:100,deadline:until()}),/response_size/);
  assert.equal(io.stats().requests,2);
});
test('compressed responses with no Content-Length are rejected and cancelled before JSON or LIST parsing',async()=>{
  for(const kind of ['json','list']) {
    let cancelled=false;const calls=[];
    const io=transport(async(_url,options)=>{calls.push(options);return new Response(new ReadableStream({
      start(controller){controller.enqueue(new TextEncoder().encode(kind==='json'?'{}':xmlList([])));},
      cancel(){cancelled=true;}}),{headers:{etag:'"fixture"','content-encoding':'gzip'}});});
    const request=kind==='json'?io.readJson({target,key:RAW_GC_POLICY_KEY,maxBytes:100,deadline:until()})
      :io.listPage({target,prefix,maxKeys:10,deadline:until()});
    await assert.rejects(request,/raw_gc_s3_response_encoding/);
    assert.equal(calls.length,1);assert.equal(calls[0].headers['accept-encoding'],'identity');
    assert.equal(cancelled,true);assert.equal(io.stats().responseBytes,0);
  }
});
test('contribution reads allow only bounded known non-Japan proofs and chunk shapes',async()=>{
  let calls=0;const io=transport(async()=>{calls++;return jsonResponse({});});
  const base='catalog/raw-feed-coordination/v1/contributions/gen_2000_fixture/encar_direct/';
  for(const key of [base+'internal.json',base+'rows/0000.json',
    'catalog/internal/offers/encar_direct/gen_2000_fixture-chunk-0001.json',
    'catalog/nonjp-intake/v1/korea/43870000000/1/files/report.json/0-'+sha(1)+'.json']) {
    assert.equal((await io.readJson({target,key,maxBytes:1024,deadline:until()})).found,true);
  }
  const prior=calls;
  for(const key of [base.replace('encar_direct','japan_auction')+'internal.json',
    base.replace('encar_direct','unknown_source')+'rows/0000.json',base+'rows/10000.json',
    'catalog/internal/offers/japan_auction/gen_2000_fixture-chunk-0001.json',
    'catalog/internal/offers/encar_direct/unbound.json',
    'catalog/nonjp-intake/v1/korea/43870000000/1/files/encar_direct-000001.jsonl/0-'+sha(1)+'.json']) {
    await assert.rejects(io.readJson({target,key,maxBytes:1024,deadline:until()}));
  }
  await assert.rejects(io.readJson({target,key:base+'internal.json',maxBytes:4*1024**2+1,deadline:until()}),/proof_read_bound/);
  assert.equal(calls,prior);
});
test('header and streaming body deadlines abort the one request without a hidden retry',async()=>{
  for(const mode of ['headers','body']){
    let calls=0,cancelled=false,observedSignal;const started=Date.now();
    // Keep setup/signing time independent from the real 20ms abort timer, so
    // scheduler contention cannot turn this into the separate preflight-expiry test.
    const io=createReadOnlyRawGcS3Transport({environment:env,now:()=>started,fetchImpl:async(_url,options)=>{calls++;observedSignal=options.signal;
      if(mode==='headers')return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('private timeout payload')),{once:true}));
      return new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{etag:'"fixture"'}});
    }});
    await assert.rejects(io.readJson({target,key:RAW_GC_POLICY_KEY,maxBytes:100,deadline:started+20}),/raw_gc_s3_aborted/);
    assert.equal(calls,1);assert.equal(observedSignal.aborted,true);if(mode==='body')assert.equal(cancelled,true);
  }
});
test('external cancellation and expired deadlines do not create a request',async()=>{
  let calls=0;const controller=new AbortController();controller.abort();
  const io=createReadOnlyRawGcS3Transport({environment:env,signal:controller.signal,fetchImpl:async()=>{calls++;return jsonResponse({});}});
  await assert.rejects(io.readJson({target,key:RAW_GC_POLICY_KEY,maxBytes:100,deadline:until()}),/aborted/);
  await assert.rejects(transport(async()=>{calls++;return jsonResponse({});}).readJson({target,key:RAW_GC_POLICY_KEY,maxBytes:100,deadline:Date.now()-1}),/deadline/);
  assert.equal(calls,0);
});
test('a transport that ignores abort still cannot hold the caller beyond its deadline',async()=>{
  let observedSignal;const started=Date.now(),io=createReadOnlyRawGcS3Transport({environment:env,now:()=>started,
    fetchImpl:async(_url,options)=>{observedSignal=options.signal;return new Promise(()=>{});}});
  await assert.rejects(io.readJson({target,key:RAW_GC_POLICY_KEY,maxBytes:100,deadline:started+20}),/aborted/);
  assert.equal(observedSignal.aborted,true);assert.equal(io.stats().requests,1);
});
test('verbose multi-delete results require an exact per-key success/error bijection and omit private error messages',()=>{
  const rows=[metadata(),metadata(root+'/1.gz')],first=target.prefix+rows[0].key,second=target.prefix+rows[1].key;
  const xml='<DeleteResult><Deleted><Key>'+first+'</Key></Deleted><Error><Key>'+second+'</Key><Code>AccessDenied</Code><Message>private-owner</Message></Error></DeleteResult>';
  const result=parseRawGcS3Delete(xml,rows);assert.equal(result.settled,true);assert.equal(result.requestSha256,rawDigest(rows));
  assert.deepEqual(result.results,[{key:rows[0].key,status:'deleted'},{key:rows[1].key,status:'error'}]);assert.ok(!JSON.stringify(result).includes('private-owner'));
  for(const broken of [xml.replace(second,first),xml.replace(second,'outside/key'),'<DeleteResult/>',xml.replace('</DeleteResult>',''),
    xml.replace('</DeleteResult>','<Deleted><Key>'+first+'</Key></Deleted></DeleteResult>')])assert.throws(()=>parseRawGcS3Delete(broken,rows),/raw_gc_s3_/);
});

class S3Fixture {
  values=new Map();calls=[];failKeys=new Set();postMode='normal';putConflict=false;postBodyCancelled=false;
  set(key,value,date=stamp){const bytes=Buffer.from(JSON.stringify(value));this.values.set(key,{value,bytes,etag:'"'+createHash('md5').update(bytes).digest('hex')+'"',lastModified:date,size:bytes.length});}
  rows(prefix){return [...this.values].filter(([key])=>key.startsWith(prefix)).map(([key,row])=>({key,size:row.size,lastModified:row.lastModified,etag:row.etag})).sort((a,b)=>a.key.localeCompare(b.key));}
  fetch=async(url,options)=>{
    assert.equal(url.origin,target.endpoint);assert.equal(options.redirect,'error');this.calls.push({url:new URL(url),method:options.method,headers:{...options.headers},body:options.body});
    if(url.searchParams.get('list-type')==='2'){
      const physical=url.searchParams.get('prefix');assert.ok(physical.startsWith(target.prefix));const rel=physical.slice(target.prefix.length);
      const rows=this.rows(rel),offset=Number(url.searchParams.get('continuation-token')||0),maxKeys=Number(url.searchParams.get('max-keys')),part=rows.slice(offset,offset+maxKeys);
      return new Response(xmlList(part,{prefix:rel,maxKeys,cursor:url.searchParams.get('continuation-token'),truncated:offset+part.length<rows.length,
        ...(offset+part.length<rows.length?{nextCursor:String(offset+part.length)}:{})}));
    }
    if(options.method==='POST'){
      assert.equal(url.search,'?delete=');assert.ok(!Object.hasOwn(options.headers,'if-match'));assert.match(options.body,/<Quiet>false<\/Quiet>/);
      assert.equal(options.headers['content-md5'],createHash('md5').update(options.body).digest('base64'));
      const state=this.values.get(RAW_COORDINATION_KEY).value;assert.equal(state.gc.inflight.phase,'active');
      const keys=[...options.body.matchAll(/<Key>([^<]+)<\/Key>/g)].map(match=>match[1]);
      if(this.postMode==='abort')throw Error('private network error');
      if(this.postMode==='503')return new Response('private server failure',{status:503});
      if(this.postMode==='body_stall')return new Response(new ReadableStream({cancel:()=>{this.postBodyCancelled=true;}}));
      const result=keys.map(physical=>{assert.ok(physical.startsWith(target.prefix));const key=physical.slice(target.prefix.length);
        if(this.failKeys.has(key))return '<Error><Key>'+physical+'</Key><Code>InternalError</Code><Message>private</Message></Error>';
        this.values.delete(key);return '<Deleted><Key>'+physical+'</Key></Deleted>';
      });
      return new Response('<DeleteResult>'+result.join('')+'</DeleteResult>');
    }
    const physical=decodeURIComponent(url.pathname.slice(('/'+target.bucket+'/').length));assert.ok(physical.startsWith(target.prefix));const key=physical.slice(target.prefix.length),old=this.values.get(key);
    if(options.method==='PUT'){
      assert.ok(options.headers['if-match']||options.headers['if-none-match']);
      if(this.putConflict||options.headers['if-none-match']==='*'&&old||options.headers['if-match']&&old?.etag.slice(1,-1)!==options.headers['if-match'])return new Response('',{status:412});
      if(options.headers['if-match'])assert.ok(!options.headers['if-match'].includes('"'));
      this.set(key,JSON.parse(options.body));return new Response('');
    }
    if(!old)return new Response(null,{status:404});
    const headers={etag:old.etag,'content-length':String(old.size),'last-modified':new Date(old.lastModified).toUTCString()};
    return new Response(options.method==='HEAD'?null:old.bytes,{headers});
  };
}
async function executableFixture(){
  const server=new S3Fixture(),owner={runId:env.GITHUB_RUN_ID,attempt:env.GITHUB_RUN_ATTEMPT,sourceSha:env.GITHUB_SHA};
  const manifest=n=>({version:2,generationId:'gen_'+(1000+n)+'_fixture'+n,markets:{}}),current=manifest(1),previous=manifest(0);
  const provenance=value=>buildRawGenerationProvenance({manifest:value,paidReports:{generationId:value.generationId,manifestSha256:rawDigest(value),market:'korea',count:0,paidCount:0,chunkProofs:[],observations:[],references:[]}});
  const cp=provenance(current),pp=provenance(previous);server.set('catalog/manifest.json',current);server.set('catalog/previous-manifest.json',previous);
  server.set(rawGenerationKey(current.generationId),cp);server.set(rawGenerationKey(previous.generationId),pp);
  let state=createRawCoordination({registryId:sha(999),current:rawCatalogDescriptor(current,cp),previous:rawCatalogDescriptor(previous,pp),
    pointers:RAW_COORDINATED_POINTERS.map(id=>({id,current:id===RAW_INTERNAL_COORDINATION_ID?rawInternalPointerDescriptor(null):rawPointerDescriptor(null,[],{complete:true})}))});
  const step=command=>{const result=transitionRawCoordination(state,{...command,expectedRevision:state.revision});state=result.state;return result;};
  const receipts={},roots=[1,2,3].map(n=>root.slice(0,-1)+n);
  for(const [index,r] of roots.entries()){
    const receipt={version:1,binding:sha(index+1),cursor:10,bytes:1,parts:[{bytes:1,sha256:sha(99)}]},date=new Date(Date.UTC(2026,0,index+1)).toISOString();
    receipts[r]=receipt;server.set(r+'/manifest.json',receipt,date);server.set(r+'/0.gz','payload',date);
    step({type:'register',operationId:'register_'+index,owner,token:sha(index+10),references:[{kind:'che168-replica',root:r}]});
  }
  step({type:'verify_coverage',report:{version:1,complete:true,registryId:state.registryId,atRevision:state.revision,currentSha256:rawDigest(state.catalog.current),
    previousSha256:rawDigest(state.catalog.previous),pointersSha256:rawDigest(state.pointers),writerInventorySha256:sha(30),pinInventorySha256:sha(31),objectInventorySha256:sha(32),
    writers:RAW_COORDINATED_WRITERS.map(id=>({id,sourceSha:owner.sourceSha,mode:'coordinated',protocolVersion:1})),legacyJobsComplete:true,legacyJobs:[]}});
  const plain=rows=>rows.map(({key,size,lastModified})=>({key,size,lastModified}));
  for(const r of roots){const row=state.roots.find(row=>row.root===r);step({type:'prove_root',root:r,incarnation:row.incarnation,rootRevision:row.revision,
    inventorySha256:rawDigest(plain(server.rows(r+'/'))),receiptSha256:rawDigest(receipts[r]),writerProofSha256:sha(80),coverageProofSha256:state.coverage.proofSha256});}
  server.set(RAW_COORDINATION_KEY,state);server.set(RAW_GC_POLICY_KEY,{version:1,mode:'required',protocolVersion:1,registryId:state.registryId});
  const retentionInputs={inventory:{complete:true,prefixes:Object.values(RAW_PREFIXES),objects:roots.flatMap(r=>plain(server.rows(r+'/'))),receipts},
    pinInventory:{complete:true,pins:[]},cursorInventory:{complete:true,references:[]},producerProtocolComplete:true,currentManifest:current,previousManifest:previous,currentProvenance:cp,previousProvenance:pp};
  const planned=await prepareRawGcPlan({io:transport(server.fetch),retentionInputs});assert.equal(planned.status,'ready',planned.reason);const evidence=planned.evidence;
  const arm={version:1,action:'delete_verified_unreferenced_raw',operationId:'mock_s3_gc',owner,registryId:state.registryId,
    coverageProofSha256:state.coverage.proofSha256,evidenceSha256:evidence.sha256,planSha256:evidence.planSha256,target};
  return {server,evidence,arm,environment:env,fetchImpl:server.fetch};
}
test('GC verifies nonempty internal contributions through bounded HTTP and refuses altered actual bytes',async()=>{
  for(const mode of ['complete','chunk','materialization','archive_report','proof_missing']) {
    const fixture=await executableFixture(),input=sourceContributionFixture(),server=fixture.server;
    const verified=await verifySourceContribution({storage:input.storage,...input.reference,internalManifest:input.internalManifest});
    const provenance=buildRawInternalProvenance({manifest:input.internalManifest,contributions:[verified]});
    for(const [key,value] of input.objects)server.set(key,value);
    server.set(RAW_INTERNAL_MANIFEST_KEY,input.internalManifest);
    server.set(rawInternalProvenanceKey(input.internalManifest.generationId),provenance);
    let state=server.values.get(RAW_COORDINATION_KEY).value;
    const advance=command=>{const result=transitionRawCoordination(state,{...command,expectedRevision:state.revision});state=result.state;return result;};
    advance({type:'register',operationId:'independent_fixture',owner:fixture.arm.owner,token:sha(700),references:verified.references});
    const pointer=state.pointers.find(row=>row.id===RAW_INTERNAL_COORDINATION_ID);
    const pending=advance({type:'reserve_pointer',operationId:'internal_fixture',owner:fixture.arm.owner,token:sha(701),
      id:pointer.id,pointerRevision:pointer.revision,base:pointer.current,candidate:rawInternalPointerDescriptor(input.internalManifest,provenance)});
    advance({type:'commit_pointer',id:pointer.id,ticket:pending.result,observedValue:input.internalManifest});
    server.set(RAW_COORDINATION_KEY,state);
    if(mode==='chunk')server.set(input.internalKey,[{...input.rows[0],sourcePrice:999},input.rows[1]]);
    if(mode==='materialization')server.set(input.partKey,{...input.objects.get(input.partKey),rows:[]});
    if(mode==='archive_report')server.set(input.archive.files.find(row=>row.name==='report.json').parts[0].key,{version:1});
    if(mode==='proof_missing')server.values.delete(input.reference.key);
    server.calls=[];const result=await readRawGcAuthority({io:transport(server.fetch)});
    if(mode==='complete') {
      assert.equal(result.status,'ready',result.reason);
      for(const key of [input.reference.key,input.partKey,input.internalKey,
        input.archive.files.find(row=>row.name==='report.json').parts[0].key]) {
        assert.ok(server.calls.some(row=>decodeURIComponent(row.url.pathname).endsWith('/'+key)),key);
      }
    } else {assert.equal(result.status,'protected_unknown',mode);assert.equal(result.reason,'internal_catalog_unproven',mode);}
    assert.ok(server.calls.every(row=>row.method==='GET'));
  }
});
test('executor transport preserves conditional REG PUT and verbose per-key partial deletion through real HTTP shapes',async()=>{
  const fixture=await executableFixture();fixture.server.failKeys.add(root+'/0.gz');
  const first=await executeRawGcWithS3(fixture);assert.equal(first.status,'paused');assert.equal(first.acknowledgedObjects,1);
  fixture.server.failKeys.clear();const second=await executeRawGcWithS3({...fixture,resumeTicket:first.ticket});assert.equal(second.status,'completed');assert.equal(second.acknowledgedObjects,2);
  const posts=fixture.server.calls.filter(row=>row.method==='POST');assert.equal(posts.length,2);
  assert.equal([...posts[1].body.matchAll(/<Object>/g)].length,1);
  const states=fixture.server.calls.filter(row=>row.method==='PUT'&&row.url.pathname.endsWith(RAW_COORDINATION_KEY));
  assert.ok(states.length>=5&&states.every(row=>row.headers['if-match']&&!row.headers['if-match'].startsWith('"')));
  assert.ok(fixture.server.calls.filter(row=>row.method==='PUT'&&!row.url.pathname.endsWith(RAW_COORDINATION_KEY)).every(row=>row.headers['if-none-match']==='*'));
});
test('a failed POST is attempted once and leaves the existing batch active',async()=>{
  for(const postMode of ['abort','503']){
    const fixture=await executableFixture();fixture.server.postMode=postMode;
    const result=await executeRawGcWithS3(fixture);assert.equal(result.status,'needs_terminal_request_evidence');assert.equal(result.transport.post,1);
    assert.equal(fixture.server.values.get(RAW_COORDINATION_KEY).value.gc.inflight.phase,'active');
  }
});
test('a deadline during the destructive response body retains active ownership and does not acknowledge keys',async()=>{
  const fixture=await executableFixture();fixture.server.postMode='body_stall';
  const result=await executeRawGcWithS3({...fixture,config:{workMs:500}});
  assert.equal(result.status,'needs_terminal_request_evidence');assert.equal(result.acknowledgedObjects,0);assert.equal(result.transport.post,1);
  assert.equal(fixture.server.postBodyCancelled,true);assert.equal(fixture.server.values.get(RAW_COORDINATION_KEY).value.gc.inflight.phase,'active');
});
test('conditional-write conflicts stay conditional and exhaust only the existing bounded CAS retry',async()=>{
  const fixture=await executableFixture();let stateWrites=0;
  const fetchImpl=async(url,options)=>{
    if(options.method==='PUT'&&url.pathname.endsWith(RAW_COORDINATION_KEY)){stateWrites++;assert.ok(options.headers['if-match']);return new Response('',{status:409});}
    return fixture.server.fetch(url,options);
  };
  await assert.rejects(executeRawGcWithS3({...fixture,fetchImpl}),/raw_coord_cas_conflict/);
  assert.equal(stateWrites,5);assert.equal(fixture.server.calls.filter(row=>row.method==='POST').length,0);
});
test('explicit executor rejects missing or changed arm before any S3 request',async()=>{
  const fixture=await executableFixture();fixture.server.calls=[];
  await assert.rejects(executeRawGcWithS3({...fixture,arm:{...fixture.arm,planSha256:sha(1)}}),/explicit_arming/);
  assert.equal(fixture.server.calls.length,0);
});
test('read-only CLI creates an exclusive safe artifact and exposes neither execute nor arm',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'raw-gc-cli-'));
  try {
    let calls=0;const fetchImpl=async()=>{calls++;return new Response(null,{status:404});},output=path.join(directory,'plan.json');
    const result=await runRawGcReadOnlyCli({argv:['--output',output],environment:env,fetchImpl});
    assert.equal(result.status,'protected_unknown');assert.equal(result.reason,'coordination_policy_missing');
    const saved=await fs.readFile(output,'utf8');assert.ok(!saved.includes(env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY));assert.equal(JSON.parse(saved).storageWrites,0);
    assert.equal(JSON.parse(saved).transport.put,0);assert.equal(JSON.parse(saved).transport.post,0);
    for(const argv of [['--mode','execute','--output',path.join(directory,'execute.json')],['--arm','yes','--output',output],
      ['--mode','plan','--mode','inventory','--output',output],['--output','relative.json']]){
      const before=calls;await assert.rejects(runRawGcReadOnlyCli({argv,environment:env,fetchImpl}),/raw_gc_cli_/);assert.equal(calls,before);
    }
    await assert.rejects(runRawGcReadOnlyCli({argv:['--output',output],environment:env,fetchImpl}),/EEXIST/);
    assert.equal(await fs.readFile(output,'utf8'),saved);
  } finally {await fs.rm(directory,{recursive:true,force:true});}
});
test('inventory CLI scans only explicit roots and cannot turn unknown authority into deletion eligibility',async()=>{
  const fixture=await executableFixture(),directory=await fs.mkdtemp(path.join(os.tmpdir(),'raw-gc-inventory-'));
  try {
    fixture.server.values.delete(RAW_GC_POLICY_KEY);fixture.server.calls=[];
    const rootsFile=path.join(directory,'roots.json'),output=path.join(directory,'inventory.json');
    await fs.writeFile(rootsFile,JSON.stringify({version:1,roots:[root]}));
    const result=await runRawGcReadOnlyCli({argv:['--mode','inventory','--roots-file',rootsFile,'--output',output],environment:env,fetchImpl:fixture.server.fetch});
    assert.equal(result.status,'complete');const report=JSON.parse(await fs.readFile(output,'utf8'));
    assert.equal(report.eligibleForDeletion,false);assert.equal(report.authority.status,'protected_unknown');assert.equal(report.groups.length,1);
    assert.equal(report.groups[0].root,root);assert.equal(report.objects,2);assert.equal(report.storageWrites,0);assert.equal(report.deleteRequests,0);
    assert.ok(fixture.server.calls.every(row=>['GET','HEAD'].includes(row.method)));
    assert.ok(fixture.server.calls.filter(row=>row.url.searchParams.has('list-type')).every(row=>row.url.searchParams.get('prefix')===target.prefix+prefix));
  } finally {await fs.rm(directory,{recursive:true,force:true});}
});
