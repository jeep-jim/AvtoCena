import test from 'node:test';
import assert from 'node:assert/strict';
import {applyFuelRepairPlan} from '../scripts/lib/apply-catalog-fuel-evidence-repair';
import {fuelRepairDigest,repairFuelRows} from '../scripts/lib/catalog-fuel-evidence-repair';
const clone=(v:any)=>JSON.parse(JSON.stringify(v));
function fixture(){
 const id='b65974b83d5399d588073fc5',generationId='gen_1792702445675_8c312f85';
 const source={id,market:'uae',make:'Aston Martin',model:'Dbx',year:2023,trim:'Aston Martin DBX707',fuel:'petrol',powertrainKind:'combustion',operational:{semanticEvidence:{fuel:{status:'exact'},powertrainKind:{status:'exact'}}}};
 const {operational,...row}=source,other={...row,id:'111111111111111111111111',fuel:'diesel'};
 const sources=new Map([[id,source]]),items=[row,other],part={items},sha=fuelRepairDigest(part);
 const partPath=`catalog/generations/${generationId}/indexes/projection-parts/all/0-${sha}.json`,rootPath='catalog/public/projection/all.json',aliasPath='catalog/public/projection/uae.json';
 const root={storageFormat:'catalog-projection-parts-v1',generationId,count:2,parts:[{path:partPath,count:2,sha256:sha}]},alias={generationId,items};
 const objects=new Map<string,any>([[rootPath,root],[aliasPath,alias],[partPath,part]]),etags=new Map([...objects.keys()].map(path=>[path,'etag-1'])),writes:any[]=[];
 const storage={readObjectMetadata:async(path:string)=>({found:objects.has(path),etag:etags.get(path)}),getBinary:async(path:string)=>({data:Buffer.from(JSON.stringify(objects.get(path)))}),writeJson:async(path:string,value:any,condition:any)=>{
  if(condition?.ifNoneMatch==='*'&&objects.has(path)||condition?.ifMatch&&condition.ifMatch!==etags.get(path))throw Error('storage_conflict');
  assert.ok(condition?.ifMatch||condition?.ifNoneMatch);writes.push({path,value:clone(value),condition});objects.set(path,clone(value));etags.set(path,'etag-'+(writes.length+1));
 }};
 const plan={version:1,generationId,release:'a'.repeat(40),sources:[{id,digest:fuelRepairDigest(source)}],pinned:[{path:rootPath,etag:'etag-1'},{path:aliasPath,etag:'etag-1'}],budgetTargets:[{id,block:0,inOtherRows:true,hasReplay:false}],objects:[aliasPath,partPath].map(path=>{const before=objects.get(path),after={...before,items:repairFuelRows(before.items,sources).items};return {path,etag:path===aliasPath?'etag-1':null,beforeDigest:fuelRepairDigest(before),afterDigest:fuelRepairDigest(after),found:[id],changed:[id],rows:2};})};
 return {storage,plan,sources,objects,etags,writes,rootPath,aliasPath,partPath,root,part,other};
}
test('addressed apply backs up originals, changes proof only, and commits new immutable child before root CAS',async()=>{
 const f=fixture(),result=await applyFuelRepairPlan({...f,expectedDigest:fuelRepairDigest(f.plan),assertContext:async()=>{}});
 assert.equal(result.verified,true);assert.equal(result.changedValues,0);assert.equal(result.changedObjects,2);
 assert.deepEqual(f.objects.get(f.partPath),f.part);
 const root=f.objects.get(f.rootPath),newPart=f.objects.get(root.parts[0].path);
 assert.deepEqual(newPart.items[1],f.other);assert.equal(root.count,2);assert.equal(root.parts[0].count,2);
 assert.equal(f.writes.at(-1).path,f.rootPath);assert.equal(f.writes.at(-1).condition.ifMatch,'etag-1');
 assert.ok(f.writes.find(w=>w.path===root.parts[0].path)?.condition.ifNoneMatch);
 assert.equal(f.objects.get(f.aliasPath).items[0].fuelPowertrainEvidence.fuel,'petrol');
 for(const row of [newPart.items[0],f.objects.get(f.aliasPath).items[0]]){const {fuelPowertrainEvidence,...rest}=row;assert.deepEqual(rest,f.part.items[0]);}
 assert.ok(f.writes.some(w=>w.path.includes('/before/')&&fuelRepairDigest(w.value)===fuelRepairDigest(f.root)));
});
test('changed source, ETag, plan digest, unsupported replay or unexpected path stops before any writes',async()=>{
 for(const kind of ['source','etag','digest','path','replay','lease']){
  const f=fixture();let expectedDigest=fuelRepairDigest(f.plan);
  if(kind==='source')f.sources.get('b65974b83d5399d588073fc5')!.fuel='diesel';
  if(kind==='etag')f.etags.set(f.aliasPath,'newer');
  if(kind==='digest')expectedDigest='0'.repeat(64);
  if(kind==='path'){f.plan.objects[0].path='catalog/private-unrelated.json';expectedDigest=fuelRepairDigest(f.plan);}
  if(kind==='replay'){f.plan.budgetTargets[0].inOtherRows=false;expectedDigest=fuelRepairDigest(f.plan);}
  await assert.rejects(()=>applyFuelRepairPlan({...f,expectedDigest,assertContext:async()=>{if(kind==='lease')throw Error('lost lease');}}));
  assert.equal(f.writes.length,0,kind);
 }
});
test('conflict at root publication preserves original root and original immutable child',async()=>{
 const f=fixture(),write=f.storage.writeJson;
 f.storage.writeJson=async(path,value,condition)=>{if(path===f.rootPath)throw Error('storage_conflict');return write(path,value,condition);};
 await assert.rejects(()=>applyFuelRepairPlan({...f,expectedDigest:fuelRepairDigest(f.plan),assertContext:async()=>{}}),/storage_conflict/);
 assert.deepEqual(f.objects.get(f.rootPath),f.root);assert.deepEqual(f.objects.get(f.partPath),f.part);
});
