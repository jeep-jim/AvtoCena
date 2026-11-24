import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {signRawGcS3Request} from '../lib/catalog-raw-gc-s3.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{throw Error('china_private_'+code);};
const LIMIT=64*1024;

// Kept equivalent to the reviewed private-stage ACL/policy checks in
// d7b193855b37aa83bf79a3afb38902ee2f20ba30. No ACL or bucket policy is changed.
export function privateOwnerAcl(xml) {
  const compact=xml.trim().replace(/^<\?xml version="1\.0"(?: encoding="(?:UTF-8|utf-8)")?\?>\s*/,'');
  const display='(?:<DisplayName>[^<&]*<\\/DisplayName>)?',id='([a-zA-Z0-9_.:@-]{1,256})';
  const fields='<ID>'+id+'<\\/ID>'+display;
  const pattern=new RegExp('^<AccessControlPolicy(?: xmlns="http://s3\\.amazonaws\\.com/doc/2006-03-01/")?>\\s*<Owner>\\s*'+
    fields+'\\s*</Owner>\\s*<AccessControlList>\\s*<Grant>\\s*'+
    '<Grantee xmlns:xsi="http://www\\.w3\\.org/2001/XMLSchema-instance" xsi:type="CanonicalUser">\\s*'+fields+
    '\\s*</Grantee>\\s*<Permission>FULL_CONTROL</Permission>\\s*</Grant>\\s*</AccessControlList>\\s*</AccessControlPolicy>$');
  const match=pattern.exec(compact.replace(/>\s+</g,'><'));
  if(!match||match[1]!==match[2])fail('owner_only_acl_required');
  return match[1];
}

export function nonGrantingPolicy(status,body) {
  if(status===404&&/^\s*(?:<\?xml version="1\.0"(?: encoding="(?:UTF-8|utf-8)")?\?>\s*)?<Error>\s*<Code>NoSuchBucketPolicy<\/Code>[\s\S]*<\/Error>\s*$/.test(body))
    return sha('verified-absent-bucket-policy');
  if(status!==200)fail('bucket_policy_unverified');
  let value;
  try {
    const keys=new Set();
    for(const token of body.match(/"(?:[^"\\]|\\.)*"\s*:/g)??[]) {
      const key=JSON.parse(token.slice(0,token.lastIndexOf(':')).trim());
      if(keys.has(key))fail('duplicate_policy_keys');keys.add(key);
    }
    value=JSON.parse(body);
  }catch{fail('bucket_policy_unverified');}
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['Version','Id','Statement'].includes(key))||
    value.Version!=='2012-10-17')fail('bucket_policy_unverified');
  const statements=Array.isArray(value.Statement)?value.Statement:[value.Statement];
  if(!statements.length||!statements.every(row=>row&&typeof row==='object'&&!Array.isArray(row)&&row.Effect==='Deny'))
    fail('bucket_policy_grant_not_supported');
  return sha(body);
}

/** A small capability for one new private generation. No deletes, list calls,
 * arbitrary keys, anonymous requests, redirects or unconditional overwrites. */
export function createPrivateChinaStorage({environment=process.env,root,fetcher=fetch}) {
  assert(/^catalog\/market-rebuild\/v1\/china\/runs\/[1-9]\d{0,19}\/[1-9]\d{0,5}\/source$/.test(root),
    'china_private_storage_root');
  for(const [key,value] of Object.entries({YC_OBJECT_STORAGE_ENDPOINT:'https://s3.regru.cloud',YC_OBJECT_STORAGE_REGION:'us-east-1',
    YC_OBJECT_STORAGE_BUCKET:'avtocena-staging-8120751',YC_OBJECT_STORAGE_PREFIX:'migration-staging/full-20261011/'}))
    assert.equal(environment[key],value,'china_private_storage_configuration');
  const accessKeyId=environment.YC_OBJECT_STORAGE_ACCESS_KEY_ID,secretAccessKey=environment.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY;
  assert(typeof accessKeyId==='string'&&accessKeyId.length>0&&typeof secretAccessKey==='string'&&secretAccessKey.length>0,
    'china_private_storage_credentials');
  const host='s3.regru.cloud',bucket=environment.YC_OBJECT_STORAGE_BUCKET,prefix=environment.YC_OBJECT_STORAGE_PREFIX;
  let privacy;
  const validKey=key=>key===root+'/complete.json'||new RegExp('^'+root+'/files/(?:source\\.sqlite|dispositions\\.ndjson|reconciliation\\.json|source-manifest\\.json)/[0-9]+-[a-f0-9]{64}$').test(key);
  async function request(method,key,query={},body,headers={},limit=LIMIT) {
    assert(key===null||validKey(key),'china_private_storage_key');
    const target='/'+bucket+(key===null?'':'/'+prefix+key);
    const signed=signRawGcS3Request({method,host,path:target,query,body:body??'',headers,region:'us-east-1',
      accessKeyId,secretAccessKey,at:Date.now()});
    let response;
    try {response=await fetcher('https://'+host+signed.canonicalPath+(signed.canonicalQuery?'?'+signed.canonicalQuery:''),
      {method,headers:signed.headers,body,redirect:'error',signal:AbortSignal.timeout(30000)});}catch{fail('storage_transport');}
    const parts=[];let size=0;
    try {for await(const part of response.body??[]) {
      size+=part.byteLength;if(size>limit)fail('storage_response_size');parts.push(Buffer.from(part));
    }}catch{fail('storage_response_incomplete');}
    return {status:response.status,data:Buffer.concat(parts)};
  }
  async function assertPrivateBucket() {
    const acl=await request('GET',null,{acl:''});
    if(acl.status!==200)fail('bucket_acl_unverified');
    const owner=privateOwnerAcl(acl.data.toString('utf8'));
    const policy=await request('GET',null,{policy:''});
    const current={owner,policySha256:nonGrantingPolicy(policy.status,policy.data.toString('utf8'))};
    if(privacy)assert.deepEqual(current,privacy,'china_private_bucket_changed');
    else privacy=current;
    return {verified:true};
  }
  return {driver:'object',assertPrivateBucket,
    async putBinary(key,bytes,contentType,condition) {
      assert(privacy,'china_private_bucket_not_verified');
      assert(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=8*1024*1024,'china_private_storage_body');
      assert.deepEqual(condition,{ifNoneMatch:'*'},'china_private_create_only');
      const result=await request('PUT',key,{},bytes,{'content-type':contentType,'if-none-match':'*','x-amz-acl':'private'});
      if(result.status!==200&&result.status!==201)fail('storage_create_failed');
      return {size:bytes.length,checksum:sha(bytes)};
    },
    async getBinary(key) {
      assert(privacy,'china_private_bucket_not_verified');
      const acl=await request('GET',key,{acl:''});
      if(acl.status!==200||privateOwnerAcl(acl.data.toString('utf8'))!==privacy.owner)fail('object_acl_unverified');
      const result=await request('GET',key,{},undefined,{},8*1024*1024);
      if(result.status!==200)fail('storage_readback_failed');
      return {data:result.data,size:result.data.length,checksum:sha(result.data)};
    }};
}
