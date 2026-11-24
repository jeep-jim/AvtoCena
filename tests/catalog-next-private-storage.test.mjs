import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateChinaStorage,privateOwnerAcl,nonGrantingPolicy} from '../scripts/catalog-next/private-storage.mjs';

const environment={YC_OBJECT_STORAGE_ENDPOINT:'https://s3.regru.cloud',YC_OBJECT_STORAGE_REGION:'us-east-1',
  YC_OBJECT_STORAGE_BUCKET:'avtocena-staging-8120751',YC_OBJECT_STORAGE_PREFIX:'migration-staging/full-20261011/',
  YC_OBJECT_STORAGE_ACCESS_KEY_ID:'test-key',YC_OBJECT_STORAGE_SECRET_ACCESS_KEY:'test-secret'};
const root='catalog/market-rebuild/v1/china/runs/123/1/source';
const key=root+'/files/source.sqlite/0-'+'a'.repeat(64);
const acl=(owner='owner')=>`<AccessControlPolicy xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Owner><ID>${owner}</ID></Owner><AccessControlList><Grant><Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="CanonicalUser"><ID>${owner}</ID></Grantee><Permission>FULL_CONTROL</Permission></Grant></AccessControlList></AccessControlPolicy>`;
const noPolicy='<Error><Code>NoSuchBucketPolicy</Code></Error>';

test('public grants, foreign owners and unverified bucket policy cannot authorize private feed upload',()=>{
  assert.equal(privateOwnerAcl(acl()),'owner');
  assert.throws(()=>privateOwnerAcl(acl().replace('<Permission>FULL_CONTROL','<Permission>READ')),/owner_only/);
  assert.throws(()=>privateOwnerAcl(acl().replace('<Grantee xmlns:xsi','<Grantee bad="value" xmlns:xsi')),/owner_only/);
  assert.throws(()=>privateOwnerAcl(acl().replace('<ID>owner</ID></Grantee>','<ID>other</ID></Grantee>')),/owner_only/);
  assert.match(nonGrantingPolicy(404,noPolicy),/^[a-f0-9]{64}$/);
  assert.throws(()=>nonGrantingPolicy(403,''),/unverified/);
  assert.throws(()=>nonGrantingPolicy(200,JSON.stringify({Version:'2012-10-17',Statement:{Effect:'Allow',Principal:'*'}})),/grant/);
  assert.throws(()=>nonGrantingPolicy(200,'{"Version":"2012-10-17","Statement":{"Effect":"Allow","Effect":"Deny"}}'),/unverified/);
});

test('the transport creates only private conditional objects and verifies owner ACL on every readback',async()=>{
  const requests=[],objects=new Map();
  let objectOwner='owner';
  const storage=createPrivateChinaStorage({environment,root,fetcher:async(url,options)=>{
    requests.push({url,options});const parsed=new URL(url);
    assert.equal(parsed.origin,'https://s3.regru.cloud');assert.equal(options.redirect,'error');
    assert.match(options.headers.authorization,/^AWS4-HMAC-SHA256/);
    if(parsed.searchParams.has('policy'))return new Response(noPolicy,{status:404});
    if(parsed.searchParams.has('acl'))return new Response(acl(parsed.pathname.endsWith('/avtocena-staging-8120751')?'owner':objectOwner));
    if(options.method==='PUT'){
      assert.equal(options.headers['if-none-match'],'*');assert.equal(options.headers['x-amz-acl'],'private');
      objects.set(parsed.pathname,Buffer.from(options.body));return new Response('');
    }
    assert(objects.has(parsed.pathname));return new Response(objects.get(parsed.pathname));
  }});
  await assert.rejects(storage.putBinary(key,Buffer.from('private'),'application/octet-stream',{ifNoneMatch:'*'}),/not_verified/);
  await storage.assertPrivateBucket();
  await storage.putBinary(key,Buffer.from('private'),'application/octet-stream',{ifNoneMatch:'*'});
  assert.equal((await storage.getBinary(key)).data.toString(),'private');
  objectOwner='foreign';await assert.rejects(storage.getBinary(key),/object_acl/);
  await assert.rejects(storage.putBinary('catalog/manifest.json',Buffer.from('x'),'application/json',{ifNoneMatch:'*'}),/key/);
  await assert.rejects(storage.putBinary(key,Buffer.from('x'),'application/json',{}),/create_only/);
  assert.equal(requests.filter(row=>row.options.method==='PUT').length,1);
});

test('bucket privacy failure has no mutation path',async()=>{
  const methods=[];
  const storage=createPrivateChinaStorage({environment,root,fetcher:async(_url,options)=>{
    methods.push(options.method);return new Response('unverified acl');
  }});
  await assert.rejects(storage.assertPrivateBucket(),/owner_only/);
  assert.deepEqual(methods,['GET']);
  assert.equal('deleteObjects' in storage,false);assert.equal('writeJson' in storage,false);
});
