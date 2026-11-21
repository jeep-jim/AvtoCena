import test from 'node:test';
import assert from 'node:assert/strict';
import {REAL,prefix} from './repair.mjs';
import {makeUaeRebindStorage} from './storage.mjs';
const XML='<AccessControlPolicy><Owner><ID>owned</ID></Owner><AccessControlList><Grant><Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="CanonicalUser"><ID>owned</ID></Grantee><Permission>FULL_CONTROL</Permission></Grant></AccessControlList></AccessControlPolicy>';
const notFound='<Error><Code>NoSuchBucketPolicy</Code></Error>';
const newId='44879999123',gate='a'.repeat(64),base=prefix(newId);
function fixture(mode){
 const calls=[],objects=new Map();
 let bucketPolicy='absent';
 const fetcher=async (u,{method,headers,body,redirect})=>{
  calls.push([method,u.pathname,u.search]);assert.equal(u.origin,'https://s3.regru.cloud');assert.equal(redirect,'error');
  assert.match(headers.authorization,/SignedHeaders=.*;x-amz-date, Signature=[0-9a-f]{64}$/);
  if(u.search==='?policy=')return new Response(bucketPolicy==='absent'?notFound:'{}',{status:bucketPolicy==='absent'?404:200});
  if(u.search==='?acl=')return new Response(XML);
  if(method==='PUT'){
   assert.equal(headers['if-none-match'],'*');assert.equal(headers['x-amz-acl'],'private');
   if(objects.has(u.pathname))return new Response(null,{status:412});
   objects.set(u.pathname,body);return new Response(null,{status:200});
  }
  return objects.has(u.pathname)?new Response(objects.get(u.pathname)):new Response('<Error/>',{status:404});
 };
 const api=makeUaeRebindStorage({runId:newId,access:'unit-fixture',secret:'unit-fixture',mode,fetcher,now:()=>REAL.legalValidUntil-3600000});
 return {api,calls,manifest:()=>{bucketPolicy='bad';}};
}
test('proof process can never obtain write capability or read source outside exact scope',async()=>{
 const {api,calls}=fixture('proof'),p=await api.permission();
 assert.throws(()=>api.openPrivateOnlyCapability({gateSha:gate,expectedGateSha:gate,privacy:p}),/fresh_proof_required/);
 await assert.rejects(api.get('catalog/anything/credentials.json',32),/read_scope/);
 await assert.rejects(api.get(REAL.sourceKey.replace('/v1/','/v2/'),32),/read_scope/);
 assert.ok(calls.every(c=>c[0]==='GET'));
});
test('fresh capability only private conditional new prefix; same owner/readback required and changing policy holds',async()=>{
 const {api,calls,manifest}=fixture('rebind'),privacy=await api.permission();
 assert.throws(()=>api.openPrivateOnlyCapability({gateSha:gate,expectedGateSha:'b'.repeat(64),privacy}),/fresh_proof_required/);
 const cap=api.openPrivateOnlyCapability({gateSha:gate,expectedGateSha:gate,privacy});
 const body=Buffer.from('{}');
 await assert.rejects(cap.createOnly(prefix(REAL.runId)+'READY.json',body,{ifNoneMatch:'*'}),/write_scope/);
 await assert.rejects(cap.createOnly(base+'projection/0.json',body,{}),/require_if_none_match/);
 assert.equal(await cap.createOnly(base+'projection/0.json',body,{ifNoneMatch:'*'}),'created');
 assert.equal(await cap.createOnly(base+'projection/0.json',body,{ifNoneMatch:'*'}),'already-exact-check-required');
 assert.deepEqual(await cap.readPrivateSameOwner(base+'projection/0.json',2),body);
 assert.ok(calls.filter(c=>c[0]==='PUT').every(c=>c[1].includes(base)));
 manifest();await assert.rejects(cap.assertAuthorization(),/bucket_policy_unverified_200/);
});
