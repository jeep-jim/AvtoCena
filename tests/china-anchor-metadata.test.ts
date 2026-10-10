import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {getJsonStorage} from '../apps/web/lib/data';
import {chinaCnyPriceFingerprint,withChinaCnyPrices,resetChinaCnyPriceCache} from '../apps/web/lib/catalog/china-cny-price';

test('fingerprints use only object metadata; USD conversion fetches the matching version and observes replacements',async(t)=>{
 const storage=getJsonStorage(),read=storage.readJsonWithMeta,metadata=storage.readObjectMetadata;
 let etag='"v1"',bodyReads=0,heads=0;
 const offer:any={id:'fixture',market:'china',sourceCurrency:'USD',sourcePrice:10000};
 const key=createHash('sha256').update(JSON.stringify([offer.id,offer.sourcePrice])).digest('hex');
 const index=()=>({version:1,entries:{[key]:{sourceCurrency:'USD',sourcePrice:10000,sourcePriceCny:etag==='"v1"'?72000:74000}}});
 storage.readObjectMetadata=async()=>{heads++;return {found:true,etag};};
 storage.readJsonWithMeta=async<T>()=>{bodyReads++;return {found:true,etag,value:index() as T};};
 try{
  resetChinaCnyPriceCache();t.mock.timers.enable({apis:['Date'],now:Date.now()});
  const fingerprints=await Promise.all(Array.from({length:20},()=>chinaCnyPriceFingerprint()));
  assert.equal(heads,1);assert.equal(bodyReads,0,'fingerprinting must not download the anchor index');
  const [first]=await withChinaCnyPrices([offer],{readOnly:true});assert.equal(first.sourcePrice,72000);assert.equal(bodyReads,1);
  await withChinaCnyPrices([offer],{readOnly:true});assert.equal(bodyReads,1);
  etag='"v2"';t.mock.timers.tick(60001);
  assert.notEqual(await chinaCnyPriceFingerprint(),fingerprints[0]);assert.equal(bodyReads,1);
  assert.equal((await withChinaCnyPrices([offer],{readOnly:true}))[0].sourcePrice,74000);assert.equal(bodyReads,2);
  // HEAD/GET race: do not use an older anchor body under a newer fingerprint.
  resetChinaCnyPriceCache();etag='"v1"';await chinaCnyPriceFingerprint();etag='"v2"';
  assert.equal((await withChinaCnyPrices([offer],{readOnly:true}))[0].sourcePrice,74000);
  assert.equal(await chinaCnyPriceFingerprint(),'object-etag:"v2"');
 }finally{storage.readJsonWithMeta=read;storage.readObjectMetadata=metadata;resetChinaCnyPriceCache();t.mock.timers.reset();}
});

test('metadata errors cannot be treated as a missing or unchanged anchor set',async()=>{
 const storage=getJsonStorage(),metadata=storage.readObjectMetadata;
 try{resetChinaCnyPriceCache();storage.readObjectMetadata=async()=>{throw Error('unavailable');};await assert.rejects(chinaCnyPriceFingerprint(),/unavailable/);}
 finally{storage.readObjectMetadata=metadata;resetChinaCnyPriceCache();}
});
