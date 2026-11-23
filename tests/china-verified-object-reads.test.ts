import './helpers/server-only-hook.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {ObjectJsonStorage} from '../apps/web/lib/data';
import {openConfiguredChinaRegcloudFiles} from '../apps/web/lib/catalog/china-regcloud-object-reader';

const hash=(body:Buffer)=>createHash('sha256').update(body).digest('hex');
const encode=(object:unknown)=>Buffer.from(JSON.stringify(object));
const sha=(object:unknown)=>hash(encode(object));

test('accepted China reuses verified bytes, checks the public ETag and isolates credential and generation changes',async t=>{
 const config={AVTOCENA_CHINA_REGCLOUD_RUNTIME:'1',YC_OBJECT_STORAGE_ENDPOINT:'https://s3.regru.cloud',
  YC_OBJECT_STORAGE_BUCKET:'fixture-bucket',YC_OBJECT_STORAGE_PREFIX:'fixture-china',YC_OBJECT_STORAGE_REGION:'fixture-region',
  YC_OBJECT_STORAGE_ACCESS_KEY_ID:'test-key',YC_OBJECT_STORAGE_SECRET_ACCESS_KEY:'test-secret'};
 for(const [key,value] of Object.entries(config)){
  const previous=process.env[key];process.env[key]=value;
  t.after(()=>{if(previous===undefined)delete process.env[key];else process.env[key]=previous;});
 }
 const origin='catalog/private-market-stage-v1/china/',local='catalog/market-activation-fixture-v1/china/';
 const objects=new Map<string,Buffer>(),reads=new Map<string,number>();
 let controlReads=0,etag='first';
 function install(generationId:string,runId:string,revision:number){
  const root=origin+runId+'/',body={id:'active-car',revision},stageControl=encode({revision});
  const deadline=Date.now()+60_000,other='a'.repeat(64);
  const runtime={version:1,kind:'china-isolated-runtime-ready',archiveSha256:other,manifestSha256:other,generationId,
   activeControlSha256:hash(stageControl),pricingReceiptSha256:other,admittedRows:1,validUntil:deadline};
  const durable={version:1,kind:'china-private-durable-stage-ready-v1',market:'china',stageRoot:root,runId,
   ...Object.fromEntries(['archiveSha256','permitSha256','manifestSha256','pricingReceiptSha256','expectedChinaPublicBaseSha256'].map(k=>[k,other])),
   generationId,admittedRows:1,validUntil:deadline,activeControlSha256:hash(stageControl),runtimeReadySha256:sha(runtime),
   artifacts:{count:3,bytes:999,orderedSha256:other},publicationAuthorized:false,cursorAdvanceAuthorized:false};
  const key=local+'generations/'+generationId+'/prepared/card.json',physical=root+'objects/'+key;
  objects.set(root+'READY.json',encode(durable));objects.set(root+'runtime-ready.json',encode(runtime));
  objects.set(root+'objects/'+local+'control.json',stageControl);objects.set(physical,encode(body));
  return {body,root,key,physical,control:{version:1,market:'china',revision,previous:null,active:{runId,generationId,readySha256:sha(durable)}}};
 }
 let stage=install('gen_1795239842026_cachetest','cache-one',2);
 t.mock.method(ObjectJsonStorage.prototype,'readScopedControl',async()=>{
  controlReads++;const data=encode(stage.control);return {data,etag,checksum:hash(data)};
 });
 t.mock.method(ObjectJsonStorage.prototype,'getBinaryBounded',async(key:string,max:number)=>{
  reads.set(key,(reads.get(key)||0)+1);
  const data=Buffer.from(objects.get(key)!);assert(data.length<=max);return {data,checksum:hash(data),size:data.length};
 });
 const first=(await openConfiguredChinaRegcloudFiles())!;
 const bad=Buffer.from('broken'),good=encode(stage.body),expected=hash(good);
 objects.set(stage.physical,bad);
 await assert.rejects(first.getBinary(stage.key,expected),/immutable_checksum/);
 objects.set(stage.physical,good);
 const parallel=await Promise.all([first.getBinary(stage.key,expected),first.getBinary(stage.key,expected)]);
 assert.equal(reads.get(stage.physical),2);
 parallel[0].data[0]=0;
 assert.deepEqual(parallel[1].data,good);
 const second=(await openConfiguredChinaRegcloudFiles())!;
 assert.deepEqual((await second.getBinary(stage.key,expected)).data,good);
 assert.equal(reads.get(stage.root+'READY.json'),1);assert.equal(reads.get(stage.physical),2);
 const initialControls=controlReads;etag='second';
 await assert.rejects(second.assertPointer(),/active_cut_changed/);assert(controlReads>initialControls);
 process.env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY='rotated-test-value';
 await assert.rejects(second.getBinary(stage.key,expected),/storage_changed/);
 const rotated=(await openConfiguredChinaRegcloudFiles())!;
 await rotated.getBinary(stage.key,expected);
 assert.equal(reads.get(stage.physical),3);assert.equal(reads.get(stage.root+'READY.json'),2);
 stage=install('gen_1795239842027_cachetest','cache-two',3);
 await assert.rejects(rotated.assertPointer(),/active_cut_changed/);
 const next=(await openConfiguredChinaRegcloudFiles())!;
 assert.deepEqual((await next.getBinary(stage.key,sha(stage.body))).data,encode(stage.body));
 assert.equal(reads.get(stage.physical),1);
});
