import test from 'node:test';
import assert from 'node:assert/strict';
import {createRegMarketPointerStorage} from '../scripts/catalog-next/market-pointer-reg-storage.mjs';
import {activateMarketGeneration} from '../scripts/catalog-next/market-data-pointer.mjs';

const PREFIX='/avtocena-staging-8120751/migration-staging/full-20261011/catalog/markets/';
const ACL='<AccessControlPolicy><Owner><ID>OWNER123</ID></Owner><AccessControlList><Grant><Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="CanonicalUser"><ID>OWNER123</ID></Grantee><Permission>FULL_CONTROL</Permission></Grant></AccessControlList></AccessControlPolicy>';
const env={YC_OBJECT_STORAGE_ENDPOINT:'https://s3.regru.cloud',YC_OBJECT_STORAGE_REGION:'us-east-1',
  YC_OBJECT_STORAGE_BUCKET:'avtocena-staging-8120751',YC_OBJECT_STORAGE_PREFIX:'migration-staging/full-20261011/',
  YC_OBJECT_STORAGE_ACCESS_KEY_ID:'fixture-key',YC_OBJECT_STORAGE_SECRET_ACCESS_KEY:'fixture-secret'};
const generation={market:'china',generationId:'gen_china_test_1',manifestSha256:'a'.repeat(64),
  pricingContextSha256:'b'.repeat(64),sourceObservedAt:'2026-11-24T10:22:41.000Z',
  pricingAsOf:'2026-11-24T10:24:33.000Z',rowCount:283188,sourceMode:'verified-full'};
const accept=({generation})=>({verified:true,manifestSha256:generation.manifestSha256});
const read=({generation})=>({verified:true,generationId:generation.generationId});

test('REG adapter is incapable of writes until bucket ownership and policy are checked',async()=>{
  const store=createRegMarketPointerStorage({environment:env,fetcher:async()=>{throw Error('should not fetch')}});
  assert.equal(Object.hasOwn(store,'list'),false);assert.equal(Object.hasOwn(store,'delete'),false);
  await assert.rejects(store.read('china'),/privacy_not_checked/);
  await assert.rejects(store.compareAndSwap('china',null,{}),/privacy_not_checked/);
  await assert.rejects(store.read('../japan'),/privacy_not_checked/);
  assert.throws(()=>createRegMarketPointerStorage({environment:{...env,YC_OBJECT_STORAGE_BUCKET:'some-other-bucket'}}),/configuration/);
});

test('signed REG CAS only touches the China pointer, never Korea or the feed',async()=>{
  const records=new Map(),calls=[];
  async function fetcher(raw,{method,headers,body}) {
    const url=new URL(raw),path=url.pathname,callsign={path,method,acl:url.searchParams.has('acl'),policy:url.searchParams.has('policy')};
    calls.push(callsign);
    if(url.searchParams.has('acl')){
      if(path==='/avtocena-staging-8120751')return new Response(ACL,{status:200});
      return new Response(records.has(path)?ACL:'',{status:records.has(path)?200:404});
    }
    if(url.searchParams.has('policy'))return new Response('<Error><Code>NoSuchBucketPolicy</Code></Error>',{status:404});
    if(method==='GET'){
      const found=records.get(path);
      return found?new Response(found.bytes,{status:200,headers:{etag:found.etag}}):new Response('',{status:404});
    }
    if(method==='PUT'){
      const current=records.get(path);
      const condition=headers['if-match'],fresh=headers['if-none-match'];
      if((current && condition!==current.etag.slice(1,-1))||(!current && fresh!=='*'))
        return new Response('',{status:412});
      const etag='"fixture-'+(records.size+1)+'"';
      records.set(path,{bytes:Buffer.from(body),etag});
      return new Response('',{status:200,headers:{etag}});
    }
    throw Error('unexpected method');
  }
  const store=createRegMarketPointerStorage({environment:env,fetcher});
  assert.deepEqual(await store.assertPrivateBucket(),{verified:true});
  assert.equal((await store.read('china')).value,null);
  const result=await activateMarketGeneration({storage:store,market:'china',generation,verifyPrepared:accept,
    verifyReading:read,now:()=>generation.pricingAsOf});
  assert.equal(result.status,'activated');
  assert.equal((await store.read('china')).value.active.generationId,generation.generationId);
  assert.ok(calls.every(x=>x.path==='/avtocena-staging-8120751'||x.path===PREFIX+'china/accepted-pointer-v1.json'));
  assert.equal(calls.filter(x=>x.method==='PUT').length,1);
  assert.equal(calls.filter(x=>x.method==='PUT')[0].path,PREFIX+'china/accepted-pointer-v1.json');
});
