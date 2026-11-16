import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {RAW_GC_TARGET,RAW_GC_POLICY_KEY,executeRawGcPlan} from './catalog-raw-gc.mjs';
import {RAW_COORDINATION_KEY,assertRawCoordination,coordinatedRawRootKind} from './catalog-raw-coordination.mjs';
import {rawInventoryGroupForObject} from './catalog-raw-retention-plan.mjs';
import {rawDigest} from './catalog-raw-provenance.mjs';
import {CONTRIBUTION_SOURCE_MARKETS,SOURCE_CONTRIBUTION_LIMITS} from '../../apps/web/lib/catalog/source-contribution-reader.mjs';

const SHA=/^[a-f0-9]{64}$/,GEN='gen_[0-9]+_[a-z0-9-]+',MAX_JSON=256*1024**2,MAX_XML=2*1024**2;
const exactReads=new Set([RAW_GC_POLICY_KEY,RAW_COORDINATION_KEY,'catalog/manifest.json','catalog/previous-manifest.json','catalog/import-lock.json',
  'catalog/internal/manifest.json','catalog/raw-feed-config/v1/che168-snapshot.json',
  ...['china','korea','uae','europe','georgia'].map(m=>'catalog/intake-cursors/v1/'+m+'.json')]);
const same=(a,b)=>rawDigest(a)===rawDigest(b),hash=value=>createHash('sha256').update(value).digest('hex');
const hmac=(key,value)=>createHmac('sha256',key).update(value).digest();
const integer=(value,max)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
const fail=code=>{throw Error('raw_gc_s3_'+code);};
const encode=value=>encodeURIComponent(value).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
const compare=(a,b)=>a<b?-1:a>b?1:0;

/** Pure SigV4 calculation; no network. The transport below supplies only its
 * pinned REG host. This is intentionally independent of data.ts's private
 * request method, which retries mutations and buffers unbounded bodies. */
export function signRawGcS3Request({method,host,path,query={},body='',headers:extra={},region,accessKeyId,secretAccessKey,at}) {
  assert.ok(['GET','HEAD','PUT','POST'].includes(method),'raw_gc_s3_method');
  const amzDate=new Date(at).toISOString().replace(/[:-]|\.\d{3}/g,''),date=amzDate.slice(0,8);
  const canonicalPath=path.split('/').map(encode).join('/');
  const canonicalQuery=Object.entries(query).map(([key,value])=>[encode(key),encode(value)])
    .sort(([a,av],[b,bv])=>compare(a,b)||compare(av,bv)).map(([key,value])=>key+'='+value).join('&');
  const payloadHash=hash(body),headers={host,'x-amz-content-sha256':payloadHash,'x-amz-date':amzDate};
  for(const [key,value] of Object.entries(extra)) {
    assert.ok(/^[a-z][a-z0-9-]*$/.test(key)&&typeof value==='string'&&!/[\r\n\x00]/.test(value),'raw_gc_s3_header');
    assert.ok(!Object.hasOwn(headers,key)&&key!=='authorization','raw_gc_s3_reserved_header');
    headers[key]=value.trim().replace(/[\t ]+/g,' ');
  }
  const names=Object.keys(headers).sort(),signedHeaders=names.join(';');
  const canonicalRequest=[method,canonicalPath,canonicalQuery,names.map(key=>key+':'+headers[key]+'\n').join(''),signedHeaders,payloadHash].join('\n');
  const scope=date+'/'+region+'/s3/aws4_request';
  const stringToSign=['AWS4-HMAC-SHA256',amzDate,scope,hash(canonicalRequest)].join('\n');
  const key=hmac(hmac(hmac(hmac('AWS4'+secretAccessKey,date),region),'s3'),'aws4_request');
  const signature=createHmac('sha256',key).update(stringToSign).digest('hex');
  headers.authorization='AWS4-HMAC-SHA256 Credential='+accessKeyId+'/'+scope+', SignedHeaders='+signedHeaders+', Signature='+signature;
  return {headers,canonicalPath,canonicalQuery,canonicalRequestSha256:hash(canonicalRequest),signature};
}

function config(environment) {
  for(const [name,value] of Object.entries({YC_OBJECT_STORAGE_ENDPOINT:RAW_GC_TARGET.endpoint,YC_OBJECT_STORAGE_BUCKET:RAW_GC_TARGET.bucket,
    YC_OBJECT_STORAGE_PREFIX:RAW_GC_TARGET.prefix,YC_OBJECT_STORAGE_REGION:'us-east-1'})) {
    assert.equal(environment[name],value,'raw_gc_s3_configuration');
  }
  const accessKeyId=environment.YC_OBJECT_STORAGE_ACCESS_KEY_ID,secretAccessKey=environment.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY;
  assert.ok(typeof accessKeyId==='string'&&/^[A-Za-z0-9_+=./-]{1,256}$/.test(accessKeyId)
    &&typeof secretAccessKey==='string'&&secretAccessKey.length>0&&secretAccessKey.length<=1024
    &&!/[\r\n\x00]/.test(secretAccessKey),'raw_gc_s3_credentials_missing');
  return {accessKeyId,secretAccessKey,region:'us-east-1'};
}
function relativeKey(key) {
  assert.ok(typeof key==='string'&&key.length<=1024&&/^[A-Za-z0-9_./-]+$/.test(key)
    &&!key.split('/').some(part=>!part||part==='.'||part==='..')&&!key.startsWith(RAW_GC_TARGET.prefix),'raw_gc_s3_relative_key');
  return key;
}
function readableKey(key) {
  relativeKey(key);
  if(exactReads.has(key)||new RegExp('^catalog/generations/'+GEN+'/raw-provenance-v1\\.json$').test(key)
    ||new RegExp('^catalog/raw-feed-coordination/v1/internal/'+GEN+'/provenance\\.json$').test(key)
    ||/^catalog\/raw-feed-gc-plans\/v1\/(?:evidence\/)?[a-f0-9]{64}\.json$/.test(key))return MAX_JSON;
  const contribution=new RegExp('^catalog/raw-feed-coordination/v1/contributions/('+GEN+')/([a-z0-9_]+)/(?:internal\\.json|manifest\\.json|rows/[0-9]{4}\\.json)$').exec(key);
  if(contribution) {
    assert.ok(Object.hasOwn(CONTRIBUTION_SOURCE_MARKETS,contribution[2]),'raw_gc_s3_contribution_source');
    return SOURCE_CONTRIBUTION_LIMITS.partBytes;
  }
  const internal=new RegExp('^catalog/internal/offers/([a-z0-9_]+)/'+GEN+'-chunk-[0-9]{4,6}\\.json$').exec(key);
  if(internal) {
    assert.ok(Object.hasOwn(CONTRIBUTION_SOURCE_MARKETS,internal[1]),'raw_gc_s3_contribution_source');
    return SOURCE_CONTRIBUTION_LIMITS.chunkBytes;
  }
  if(/^catalog\/nonjp-intake\/v1\/(?:china|korea|uae|europe|georgia)\/\d{1,20}\/[1-9]\d{0,5}\/files\/report\.json\/\d+-[a-f0-9]{64}\.json$/.test(key)) {
    return SOURCE_CONTRIBUTION_LIMITS.partBytes;
  }
  if(/^catalog\/nonjp-intake\/v1\/(?:china|korea|uae|europe|georgia)\/\d{1,20}\/[1-9]\d{0,5}\/source-input\.json$/.test(key))return 2*1024**2;
  const row=rawInventoryGroupForObject(key);
  assert.ok(['manifest.json','head.json','complete.json'].includes(row.leaf),'raw_gc_s3_json_scope');
  return MAX_JSON;
}
function rawKey(key) {relativeKey(key);rawInventoryGroupForObject(key);}
function etag(value) {
  assert.ok(typeof value==='string'&&/^"[^"\x00-\x20\x7f]{1,250}"$/.test(value),'raw_gc_s3_etag');return value;
}
function modified(value) {const date=new Date(value);assert.ok(Number.isFinite(date.getTime())&&date.getTime()>0,'raw_gc_s3_last_modified');return date.toISOString();}
function size(value) {assert.ok(typeof value==='string'&&/^(?:0|[1-9][0-9]*)$/.test(value)&&integer(Number(value),Number.MAX_SAFE_INTEGER),'raw_gc_s3_size');return Number(value);}
function xmlDecode(text) {
  assert.ok(!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)&&!/&(?!(?:amp|lt|gt|quot|apos|#[0-9]+|#x[a-fA-F0-9]+);)/.test(text),'raw_gc_s3_xml_entity');
  return text.replace(/&([^;]+);/g,(_all,name)=>{
    const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};if(Object.hasOwn(named,name))return named[name];
    const point=name[1]==='x'?Number.parseInt(name.slice(2),16):Number(name.slice(1));
    assert.ok([9,10,13].includes(point)||point>=32&&point<=0xd7ff||point>=0xe000&&point<=0xfffd
      ||point>=0x10000&&point<=0x10ffff,'raw_gc_s3_xml_entity');
    return String.fromCodePoint(point);
  });
}
function xmlEscape(text) {return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
function xmlTree(text) {
  text=text.replace(/^\uFEFF?\s*<\?xml\s+version="1\.0"(?:\s+encoding="UTF-8")?\s*\?>/i,'');
  assert.ok(!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)&&!text.includes('<!')&&!text.includes('<?'),'raw_gc_s3_xml_declaration');
  const stack=[];let root=null,pos=0,nodes=0;
  while(pos<text.length) {
    if(text[pos]!=='<') {
      const end=text.indexOf('<',pos),next=end===-1?text.length:end,value=xmlDecode(text.slice(pos,next));
      if(stack.length)stack.at(-1).text+=value;else assert.ok(!value.trim(),'raw_gc_s3_xml_trailing');
      pos=next;continue;
    }
    const end=text.indexOf('>',pos);assert.ok(end!==-1,'raw_gc_s3_xml_truncated');
    const token=text.slice(pos+1,end);pos=end+1;
    if(token.startsWith('/')) {
      const node=stack.pop();assert.ok(node&&token==='/'+node.name&&(!node.children.length||!node.text.trim()),'raw_gc_s3_xml_close');continue;
    }
    const match=/^([A-Za-z][A-Za-z0-9]*)([^<>]*?)(\/?)$/.exec(token);assert.ok(match,'raw_gc_s3_xml_tag');
    const attributes=match[2].trim();
    assert.ok(!attributes||!stack.length&&!root&&/^xmlns=["']https?:\/\/s3\.amazonaws\.com\/doc\/2006-03-01\/["']$/.test(attributes),'raw_gc_s3_xml_attributes');
    const node={name:match[1],children:[],text:''};
    assert.ok(++nodes<=20000&&stack.length<8,'raw_gc_s3_xml_bound');
    if(stack.length)stack.at(-1).children.push(node);else{assert.ok(!root,'raw_gc_s3_xml_roots');root=node;}
    if(!match[3])stack.push(node);
  }
  assert.ok(root&&stack.length===0,'raw_gc_s3_xml_truncated');return root;
}
function scalar(node,name,required=true) {
  const values=node.children.filter(row=>row.name===name);
  assert.ok(values.length<=1&&(!required||values.length===1)&&(!values.length||!values[0].children.length),'raw_gc_s3_xml_field');
  return values[0]?.text;
}
function fields(node,names) {assert.ok(node.children.every(row=>names.includes(row.name)),'raw_gc_s3_xml_unknown_field');}
function decodeListed(value,encoded) {try{return encoded?decodeURIComponent(value):value;}catch{fail('list_encoding');}}

export function parseRawGcS3List(text,{prefix,maxKeys,cursor=null}) {
  assert.ok(typeof text==='string'&&Buffer.byteLength(text)<=MAX_XML,'raw_gc_s3_xml_size');
  const root=xmlTree(text);assert.equal(root.name,'ListBucketResult','raw_gc_s3_list_root');
  fields(root,['Name','Prefix','MaxKeys','KeyCount','IsTruncated','Contents','ContinuationToken','NextContinuationToken','EncodingType']);
  assert.equal(scalar(root,'Name'),RAW_GC_TARGET.bucket,'raw_gc_s3_list_bucket');
  const encoding=scalar(root,'EncodingType',false);assert.ok(encoding===undefined||encoding==='url','raw_gc_s3_list_encoding');
  assert.equal(decodeListed(scalar(root,'Prefix'),encoding==='url'),RAW_GC_TARGET.prefix+prefix,'raw_gc_s3_list_prefix');
  assert.equal(size(scalar(root,'MaxKeys')),maxKeys,'raw_gc_s3_list_max_keys');
  const flag=scalar(root,'IsTruncated');assert.ok(['true','false'].includes(flag),'raw_gc_s3_list_truncated');
  const echoed=scalar(root,'ContinuationToken',false);if(echoed!==undefined)assert.equal(echoed,cursor,'raw_gc_s3_list_cursor');
  const objects=root.children.filter(row=>row.name==='Contents').map(node=>{
    fields(node,['Key','ETag','Size','LastModified','StorageClass','Owner','ChecksumAlgorithm','ChecksumType']);
    const full=decodeListed(scalar(node,'Key'),encoding==='url');
    assert.ok(full.startsWith(RAW_GC_TARGET.prefix+prefix),'raw_gc_s3_list_key_prefix');
    const key=full.slice(RAW_GC_TARGET.prefix.length);rawKey(key);
    return {key,size:size(scalar(node,'Size')),lastModified:modified(scalar(node,'LastModified')),etag:etag(scalar(node,'ETag'))};
  });
  assert.ok(objects.length<=maxKeys&&new Set(objects.map(row=>row.key)).size===objects.length,'raw_gc_s3_list_count');
  const count=scalar(root,'KeyCount',false);if(count!==undefined)assert.equal(size(count),objects.length,'raw_gc_s3_list_count');
  const nextCursor=scalar(root,'NextContinuationToken',false),truncated=flag==='true';
  assert.ok(truncated?typeof nextCursor==='string'&&nextCursor.length>0&&nextCursor.length<=4096&&nextCursor!==cursor
    :nextCursor===undefined,'raw_gc_s3_list_next_cursor');
  return {prefix,objects,truncated,...(truncated?{nextCursor}:{})};
}
export function parseRawGcS3Delete(text,objects) {
  assert.ok(typeof text==='string'&&Buffer.byteLength(text)<=MAX_XML,'raw_gc_s3_xml_size');
  const root=xmlTree(text);assert.equal(root.name,'DeleteResult','raw_gc_s3_delete_root');fields(root,['Deleted','Error']);
  const expected=new Set(objects.map(row=>RAW_GC_TARGET.prefix+row.key)),seen=new Set();
  const results=root.children.map(node=>{
    fields(node,node.name==='Deleted'?['Key','VersionId','DeleteMarker','DeleteMarkerVersionId']:['Key','Code','Message','VersionId']);
    const key=scalar(node,'Key');assert.ok(expected.has(key)&&!seen.has(key),'raw_gc_s3_delete_key');seen.add(key);
    if(node.name==='Error')assert.ok(/^[A-Za-z0-9_-]{1,100}$/.test(scalar(node,'Code')),'raw_gc_s3_delete_error');
    return {key:key.slice(RAW_GC_TARGET.prefix.length),status:node.name==='Deleted'?'deleted':'error'};
  });
  assert.equal(seen.size,expected.size,'raw_gc_s3_delete_incomplete');
  return {settled:true,requestSha256:rawDigest(objects),results};
}

function makeTransport({environment=process.env,fetchImpl=globalThis.fetch,now=Date.now,signal,
  limits={},execution=null}={}) {
  const credentials=config(environment),cap={requests:5000,responseBytes:64*1024**2,...limits};
  assert.ok(integer(cap.requests,600000)&&cap.requests>0&&integer(cap.responseBytes,MAX_JSON)&&cap.responseBytes>0,'raw_gc_s3_limits');
  const stats={requests:0,get:0,list:0,head:0,put:0,post:0,responseBytes:0};
  const exactTarget=value=>assert.ok(same(value,RAW_GC_TARGET),'raw_gc_s3_target');
  async function request({method,key,query={},body,headers={},deadline,maxBytes,allow404=false,conflict=false,kind}) {
    assert.ok(Number.isFinite(deadline)&&deadline>now()&&deadline-now()<=600000,'raw_gc_s3_deadline');
    assert.ok(integer(maxBytes,MAX_JSON)&&maxBytes>0&&stats.requests<cap.requests,'raw_gc_s3_request_budget');
    if(signal?.aborted)fail('aborted');
    const path='/'+RAW_GC_TARGET.bucket+(key===undefined?'':'/'+RAW_GC_TARGET.prefix+key);
    const signed=signRawGcS3Request({method,host:new URL(RAW_GC_TARGET.endpoint).host,path,query,body:body??'',
      headers:{...headers,'accept-encoding':'identity'},...credentials,at:now()});
    const url=new URL(RAW_GC_TARGET.endpoint+signed.canonicalPath+(signed.canonicalQuery?'?'+signed.canonicalQuery:''));
    assert.ok(url.origin===RAW_GC_TARGET.endpoint&&!url.username&&!url.password&&!url.hash,'raw_gc_s3_request_origin');
    assert.ok(now()<deadline,'raw_gc_s3_deadline');
    const controller=new AbortController();let interrupt;
    const interrupted=new Promise((_resolve,reject)=>{interrupt=reject;});
    const abort=()=>{controller.abort();interrupt(Error('raw_gc_s3_aborted'));};
    signal?.addEventListener('abort',abort,{once:true});
    let reader,response,timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;abort();},Math.max(1,deadline-now()));
    stats.requests++;stats[kind]++;
    const perform=async()=>{try {
      response=await fetchImpl(url,{method,headers:signed.headers,...(body===undefined?{}:{body}),redirect:'error',cache:'no-store',signal:controller.signal});
      if(controller.signal.aborted)fail('aborted');
      assert.ok(response instanceof Response&&!response.redirected&&(!response.url||response.url===url.href),'raw_gc_s3_response_origin');
      if(allow404&&response.status===404){await response.body?.cancel();return {missing:true};}
      if(conflict&&[409,412].includes(response.status)){
        await response.body?.cancel();const error=Error('raw_gc_s3_cas_conflict');error.name='StorageConflictError';throw error;
      }
      if(response.status!==200){await response.body?.cancel();fail('http_'+response.status);}
      const encoding=response.headers.get('content-encoding');
      assert.ok(!encoding||encoding.toLowerCase()==='identity','raw_gc_s3_response_encoding');
      if(method==='HEAD'){await response.body?.cancel();return {headers:response.headers,bytes:Buffer.alloc(0)};}
      const length=response.headers.get('content-length');
      if(length!==null)assert.ok(size(length)<=maxBytes&&size(length)<=cap.responseBytes-stats.responseBytes,'raw_gc_s3_response_size');
      const chunks=[];let bytes=0;
      if(response.body) {
        reader=response.body.getReader();
        const cancel=()=>{void reader.cancel().catch(()=>undefined);};controller.signal.addEventListener('abort',cancel,{once:true});
        try {
          if(controller.signal.aborted)fail('aborted');
          while(true){const chunk=await reader.read();if(controller.signal.aborted)fail('aborted');if(chunk.done)break;
            assert.ok(now()<deadline,'raw_gc_s3_deadline');
            bytes+=chunk.value.byteLength;stats.responseBytes+=chunk.value.byteLength;
            assert.ok(bytes<=maxBytes&&stats.responseBytes<=cap.responseBytes,'raw_gc_s3_response_size');chunks.push(Buffer.from(chunk.value));
          }
        } finally {controller.signal.removeEventListener('abort',cancel);}
      }
      assert.ok(now()<deadline,'raw_gc_s3_deadline');
      if(length!==null)assert.equal(bytes,size(length),'raw_gc_s3_response_length');
      return {headers:response.headers,bytes:Buffer.concat(chunks,bytes)};
    } catch(error) {
      controller.abort();if(reader)await reader.cancel().catch(()=>undefined);else await response?.body?.cancel().catch(()=>undefined);
      if(error?.name==='StorageConflictError')throw error;
      const code=String(error?.message||'').split('\n')[0];
      if(/^raw_gc_s3_[a-z0-9_]+$/.test(code))throw Error(code);
      fail(timedOut||signal?.aborted?'aborted':'transport_unknown');
    } finally {try{reader?.releaseLock();}catch{}}};
    // A deadline abort can have an unknown remote mutation outcome. Returning
    // this rejection never marks a DELETE settled; the executor retains its
    // active attempt. No retry or second destructive request is scheduled.
    try {return await Promise.race([perform(),interrupted]);}
    finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  function text(bytes){try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('response_utf8');}}
  const io={target:RAW_GC_TARGET,stats:()=>({...stats}),
    async readJson({target,key,maxBytes,deadline}) {
      exactTarget(target);assert.ok(maxBytes<=readableKey(key),'raw_gc_s3_proof_read_bound');
      const result=await request({method:'GET',key,deadline,maxBytes,allow404:true,kind:'get'});
      if(result.missing)return {found:false,value:null};
      let value;try{value=JSON.parse(text(result.bytes));}catch{fail('json_invalid');}
      assert.ok(now()<deadline,'raw_gc_s3_deadline');return {found:true,value,etag:etag(result.headers.get('etag')),bytes:result.bytes.length};
    },
    async listPage({target,prefix,cursor=null,maxKeys,deadline}) {
      exactTarget(target);assert.ok(typeof prefix==='string'&&prefix.endsWith('/')&&coordinatedRawRootKind(prefix.slice(0,-1)),'raw_gc_s3_list_scope');
      assert.ok(integer(maxKeys,1000)&&maxKeys>0&&(cursor===null||typeof cursor==='string'&&cursor.length>0&&cursor.length<=4096),'raw_gc_s3_list_request');
      const query={'list-type':'2',prefix:RAW_GC_TARGET.prefix+prefix,'max-keys':String(maxKeys),'encoding-type':'url',...(cursor===null?{}:{'continuation-token':cursor})};
      const result=await request({method:'GET',query,deadline,maxBytes:MAX_XML,kind:'list'});
      const parsed=parseRawGcS3List(text(result.bytes),{prefix,maxKeys,cursor});assert.ok(now()<deadline,'raw_gc_s3_deadline');return parsed;
    },
    async headObject({target,key,deadline}) {
      exactTarget(target);rawKey(key);
      const result=await request({method:'HEAD',key,deadline,maxBytes:1,allow404:true,kind:'head'});
      if(result.missing)return {found:false};
      return {found:true,etag:etag(result.headers.get('etag')),size:size(result.headers.get('content-length')),
        lastModified:modified(result.headers.get('last-modified'))};
    }};
  if(execution) {
    const evidence=execution.evidence,captured=new Map(evidence.inventory.flatMap(row=>row.objects).map(row=>[row.key,row]));
    io.writeJson=async({target,key,value,condition,deadline})=>{
      exactTarget(target);relativeKey(key);assert.ok(condition&&Object.keys(condition).length===1,'raw_gc_s3_write_condition');
      const headers={'content-type':'application/json; charset=utf-8'};
      if(key===RAW_COORDINATION_KEY) {
        assertRawCoordination(value);assert.ok(value.registryId===evidence.authority.registryId&&value.gc?.planSha256===evidence.planSha256,'raw_gc_s3_state_scope');
        headers['if-match']=etag(condition.ifMatch).slice(1,-1); // Existing REG wire convention in data.ts.
      } else {
        assert.equal(condition.ifNoneMatch,'*','raw_gc_s3_immutable_condition');headers['if-none-match']='*';
        assert.ok(key===evidence.planKey&&same(value,evidence.plan)
          ||key==='catalog/raw-feed-gc-plans/v1/evidence/'+evidence.sha256+'.json'&&same(value,evidence),'raw_gc_s3_write_scope');
      }
      const body=JSON.stringify(value);assert.ok(Buffer.byteLength(body)<=MAX_JSON,'raw_gc_s3_write_size');headers['content-length']=String(Buffer.byteLength(body));
      await request({method:'PUT',key,body,headers,deadline,maxBytes:65536,conflict:true,kind:'put'});
    };
    io.deleteBatch=async({target,objects,requestSha256,operation,deadline})=>{
      exactTarget(target);assert.ok(Array.isArray(objects)&&objects.length>0&&objects.length<=1000
        &&new Set(objects.map(row=>row.key)).size===objects.length&&rawDigest(objects)===requestSha256,'raw_gc_s3_delete_request');
      assert.ok(operation?.registryId===evidence.authority.registryId&&operation.operationId===execution.arm.operationId
        &&same(operation.owner,execution.arm.owner)&&SHA.test(operation.token)&&operation.attempt?.token===operation.token,'raw_gc_s3_delete_owner');
      for(const row of objects){rawKey(row.key);assert.ok(captured.has(row.key)&&same(row,captured.get(row.key)),'raw_gc_s3_delete_scope');}
      // REG support for conditional multi-delete is not assumed. CAS root
      // ownership plus proven writer coverage, not ETag here, is the lock.
      const body='<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>false</Quiet>'+objects.map(row=>'<Object><Key>'+xmlEscape(RAW_GC_TARGET.prefix+row.key)+'</Key></Object>').join('')+'</Delete>';
      const result=await request({method:'POST',query:{delete:''},body,headers:{'content-type':'application/xml',
        'content-md5':createHash('md5').update(body).digest('base64'),'content-length':String(Buffer.byteLength(body))},deadline,maxBytes:MAX_XML,kind:'post'});
      const parsed=parseRawGcS3Delete(text(result.bytes),objects);assert.ok(now()<deadline,'raw_gc_s3_deadline');return parsed;
    };
  }
  return Object.freeze(io);
}

/** No write/delete methods, no mutation environment switch. */
export function createReadOnlyRawGcS3Transport(options={}) {
  assert.equal(options.execution,undefined,'raw_gc_s3_readonly_factory');
  const {environment,fetchImpl,now,signal,limits}=options;return makeTransport({environment,fetchImpl,now,signal,limits});
}

/** Code-level future executor integration only. The CLI never imports/calls
 * this function; exact arming/owner/CAS checks run before its first request. */
export async function executeRawGcWithS3({environment=process.env,fetchImpl=globalThis.fetch,signal,transportLimits,now=Date.now,...execution}) {
  const io=makeTransport({environment,fetchImpl,signal,limits:transportLimits,now,execution});
  const result=await executeRawGcPlan({...execution,io,environment,now});return {...result,transport:io.stats()};
}
