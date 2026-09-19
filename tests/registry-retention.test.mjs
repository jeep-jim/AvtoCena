import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registryRetentionPlan,WEB_REPOSITORY,uniqueRegistryBytes} from '../scripts/lib/registry-retention.mjs';
const now=Date.parse('2026-09-19T12:00:00Z');
const images=Array.from({length:30},(_,i)=>({id:`img${i}`,name:WEB_REPOSITORY,digest:`sha256:${i}`,tags:[String(i).padStart(40,'0')],createdAt:new Date(now-(i+1)*86400000).toISOString()}));
const revision=(i,status='ACTIVE')=>({id:`revision${i}`,status,createdAt:images[i].createdAt,image:{imageUrl:`cr.yandex/${WEB_REPOSITORY}:${images[i].tags[0]}`,imageDigest:images[i].digest}});
test('keeps old active image and recent rollback images as well as latest ten',()=>{
 const result=registryRetentionPlan(images,[revision(29),revision(28,'OBSOLETE')],now);
 assert.equal(result.candidates.length,18); assert(!result.candidates.some(x=>['img29','img28','img0','img9'].includes(x.id)));
});
test('preserves pinned tags and other repositories',()=>{
 const copy=structuredClone(images); copy[20].tags.push('production'); copy.push({...images[21],id:'browser',name:'crp73he0q1blh1mujo4s/avtocena-browser'});
 const result=registryRetentionPlan(copy,[revision(29)],now);
 assert(!result.candidates.some(x=>['img20','browser'].includes(x.id)));
});
test('refuses missing runtime, missing protected image or broken date',()=>{
 assert.throws(()=>registryRetentionPlan(images,[],now),/No active/);
 assert.throws(()=>registryRetentionPlan(images.slice(0,20),[revision(29)],now),/not found/);
 assert.throws(()=>registryRetentionPlan(images.map((x,i)=>i===20?{...x,createdAt:'broken'}:x),[revision(29)],now),/Incomplete/);
});
test('protects a revision by immutable digest despite moved tags',()=>{
 const rev=revision(29); rev.image.imageUrl=`cr.yandex/${WEB_REPOSITORY}:moved`;
 assert(!registryRetentionPlan(images,[rev],now).candidates.some(x=>x.id==='img29'));
});
test('shared layers are counted once',()=>{
 assert.equal(uniqueRegistryBytes([{layers:[{digest:'x',size:'100'}]},{layers:[{digest:'x',size:'100'},{digest:'y',size:'30'}]}]),130);
});
