import test from 'node:test';
import assert from 'node:assert/strict';
import {getJsonStorage} from '../apps/web/lib/data';
import {getOfferFromCurrentProjection,readCurrentCatalogProjectionSnapshot,resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage';

for(const warm of [false,true])test(`pending global projection does not block ${warm?'cached':'cold'} market, then shares completed data`,async(t)=>{
 resetCatalogReadCachesForTests();
 const reads:string[]=[];
 let release!:()=>void,started!:()=>void;
 const waiting=new Promise<void>(resolve=>{release=resolve;});
 const entered=new Promise<void>(resolve=>{started=resolve;});
 t.mock.method(getJsonStorage(),'readJsonWithMeta',async(path:string,fallback:any)=>{
  reads.push(path);
  if(path==='catalog/manifest.json')return {found:true,value:{generationId:'one',markets:{japan:{count:0}}}};
  if(path==='catalog/public/projection/all.json'){started();await waiting;return {found:true,value:{generationId:'one',items:[]}};}
  if(path==='catalog/public/projection/japan.json')return {found:true,value:{generationId:'one',items:[]}};
  return {found:false,value:fallback};
 });
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  if(warm)assert.equal(await getOfferFromCurrentProjection('jpauc_japan_past_open:test'),null);
  const globalRead=readCurrentCatalogProjectionSnapshot();await entered;
  assert.equal(await Promise.race([getOfferFromCurrentProjection('jpauc_japan_past_open:test'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('market blocked on unrelated global download')),500);})]),null);
  clearTimeout(timer);
  assert.equal(reads.filter(p=>p==='catalog/public/projection/japan.json').length,1);
  release();await globalRead;
  assert.equal(await getOfferFromCurrentProjection('jpauc_japan_past_open:test'),null);
  assert.equal(reads.filter(p=>p==='catalog/public/projection/japan.json').length,1);
 }finally{clearTimeout(timer);release();t.mock.restoreAll();resetCatalogReadCachesForTests();}
});

test('expired projection revalidates its ETag; changed generation never reuses it',async(t)=>{
 resetCatalogReadCachesForTests();let now=Date.now(),generation='one',conditional=0,reads=0;
 t.mock.method(Date,'now',()=>now);
 t.mock.method(getJsonStorage(),'readJsonWithMeta',async(path:string,fallback:any,previous:any)=>{
  if(path==='catalog/manifest.json')return {found:true,value:{generationId:generation,markets:{}}};
  if(path==='catalog/public/projection/all.json'){
   reads++;
   if(previous){assert.equal(previous.etag,'"one"');assert.equal(generation,'one');conditional++;return previous;}
   return {found:true,etag:`"${generation}"`,value:{generationId:generation,items:[]}};
  }
  return {found:false,value:fallback};
 });
 try{
  const first=await readCurrentCatalogProjectionSnapshot();now+=301000;
  assert.equal(await readCurrentCatalogProjectionSnapshot(),first);assert.equal(conditional,1);
  generation='two';now+=301000;
  assert.equal((await readCurrentCatalogProjectionSnapshot()).generationId,'two');assert.equal(reads,3);assert.equal(conditional,1);
 }finally{resetCatalogReadCachesForTests();}
});
