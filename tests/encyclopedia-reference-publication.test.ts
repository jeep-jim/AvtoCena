import test from 'node:test';
import assert from 'node:assert/strict';
import {publishReferencePlans} from '../scripts/encyclopedia/publish-reference-plans.mjs';
import {checksum} from '../apps/web/lib/encyclopedia/calculation-index';
function setup(n=17){
 const root='knowledge/encyclopedia/v1',models=Array.from({length:n},(_,i)=>({id:String(i),revision:'old',key:`old/${i}`})),manifest={models};
 let current=structuredClone(manifest),writes=0,active=0,maxActive=0,published=0;
 const records=new Map(),plans=models.map(summary=>({summary,record:{id:summary.id,revision:'new',updatedAt:'now',variants:[]},changes:[{fields:['powerHp']}]}));
 const storage={writeJson:async(k:any,v:any)=>{active++;maxActive=Math.max(active,maxActive);await new Promise(r=>setTimeout(r,1));records.set(k,structuredClone(v));active--;},readJson:async(k:any)=>k.endsWith('manifest.json')?current:records.get(k)};
 const options={plans,manifest,storage,root,checksum,summarize:(r:any,key:string)=>({id:r.id,revision:r.revision,key}),mutateManifest:async(fn:any)=>{writes++;current=fn(current);},onBatch:async(b:any[])=>{published+=b.length;}};
 return {options,records,read:()=>({current,writes,maxActive,published}),edit:()=>current.models[0].revision='human'};
}
test('bounded immutable writes precede atomic manifest batches and retain history',async()=>{
 const x=setup();await publishReferencePlans(x.options);const r=x.read();assert.equal(r.writes,2);assert.equal(r.published,17);assert.ok(r.maxActive<=6);
 assert.ok(r.current.models.every(m=>m.revision==='new'));assert.equal(x.records.get('knowledge/encyclopedia/v1/revisions/0/new.json').previousKey,'old/0');
 assert.ok(x.options.manifest.models.every(m=>m.revision==='old'));
});
test('a concurrent manual edit prevents the batch from replacing any live record',async()=>{
 const x=setup(3),write=x.options.storage.writeJson;x.options.storage.writeJson=async(k,v)=>{await write(k,v);x.edit();};
 await assert.rejects(publishReferencePlans(x.options),/concurrent_encyclopedia_edit/);
 assert.equal(x.read().current.models[0].revision,'human');assert.equal(x.read().current.models[1].revision,'old');assert.equal(x.read().published,0);
});
test('failed immutable readback leaves the live manifest intact',async()=>{
 const x=setup(2);x.options.storage.readJson=async()=>null;
 await assert.rejects(publishReferencePlans(x.options),/reference_revision_readback_failed/);assert.equal(x.read().writes,0);
});
test('a later batch failure retains the completed batch and its progress checkpoint',async()=>{
 const x=setup(),write=x.options.storage.writeJson;x.options.storage.writeJson=async(k,v)=>{if(v.id==='16')throw Error('storage_unavailable');await write(k,v);};
 await assert.rejects(publishReferencePlans(x.options),/storage_unavailable/);assert.equal(x.read().published,16);assert.equal(x.read().current.models[16].revision,'old');
});
