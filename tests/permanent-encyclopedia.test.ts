import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createSnapshotBuilder,publishSnapshot} from '../apps/web/lib/encyclopedia/snapshot';
import {canEditEncyclopedia,editModel,createModel,readEncyclopedia,readModel,MANIFEST,EncyclopediaConflict} from '../apps/web/lib/encyclopedia/records';
import {getJsonStorage} from '../apps/web/lib/data';
import {cleanVariant} from '../apps/web/lib/encyclopedia/schema';
import {modelCsv,csvCell} from '../apps/web/lib/encyclopedia/csv';
const at='2026-10-21T08:00:00Z';
const car={make:'Toyota',model:'Corolla',year:2021,engineCc:1490,powerHp:121,drive:'fwd',fuel:'petrol',market:'china',cardImageUrl:'https://example.com/photo.jpg'};
const owner:any={id:'owner',companyId:'dealer_topavto',role:'owner',status:'active'};
test('snapshot groups models and exact annual variants, retains differences and never infers 30-minute power',()=>{
 const b=createSnapshotBuilder(at);b.add(car);b.add({...car,id:'another',price:50,mileageKm:10000});b.add({...car,year:2022});b.add({...car,powerHp:150});b.add({...car,drive:'awd'});b.add({...car,powerHp:undefined});
 assert.equal(b.models.size,1);const m=[...b.models.values()][0];assert.equal(m.variants.length,5);assert.equal(m.variants[0].observedCount,2);assert.ok(m.variants.every(v=>v.power30MinKw===undefined));assert.equal(m.photo,car.cardImageUrl);
 b.add({...car,make:'Tesla',model:'Model 3',fuel:'electric',powerKw:200,market:'uae',power30MinKw:99,power30MinKwByMotor:[99]});const u=[...b.models.values()][1].variants[0];assert.equal(u.engineCc,undefined);assert.equal(u.powerHp,undefined);assert.equal(u.power30MinKw,undefined);assert.equal(u.motors30MinKw,undefined);
});
test('failed snapshot has no live manifest; successful snapshot cannot be silently replaced',async()=>{
 const saved=new Map<string,any>();const store={readJson:async(k:string,f:any)=>saved.get(k)||f,writeJson:async(k:string,v:any)=>{if(k!==MANIFEST)throw Error('disk');saved.set(k,v);}};
 const b=createSnapshotBuilder(at);b.add(car);await assert.rejects(()=>publishSnapshot(store,b,'g1',0,at),/disk/);assert.equal(saved.has(MANIFEST),false);
 store.writeJson=async(k,v)=>{saved.set(k,structuredClone(v));};await publishSnapshot(store,b,'g1',0,at);await assert.rejects(()=>publishSnapshot(store,b,'g2',0,at),/already_exists/);assert.equal(saved.get(MANIFEST).generationId,'g1');
});
test('only TopAvto owner/admin can edit; revisions protect concurrent writes and preserve prior data',async()=>{
 for(const u of [null,{...owner,role:'manager'},{...owner,role:'dealer'},{...owner,companyId:'other'},{...owner,status:'disabled'}])assert.equal(canEditEncyclopedia(u),false);
 assert.equal(canEditEncyclopedia({...owner,role:'admin'}),true);
 const cwd=process.cwd(),root=await fs.mkdtemp(path.join(os.tmpdir(),'encyclopedia-'));const oldDriver=process.env.JSON_STORAGE_DRIVER;
 try{process.chdir(root);process.env.JSON_STORAGE_DRIVER='local';await fs.mkdir(path.join(root,'data'));const b=createSnapshotBuilder(at);b.add(car);const manifest=await publishSnapshot(getJsonStorage(),b,'generation',0,at);const id=manifest.models[0].id,m=(await readModel(id))!;
  await assert.rejects(()=>editModel(id,{revision:m.revision,variant:m.variants[0]},{...owner,companyId:'other'}),/Доступ/);
  const changed=await editModel(id,{revision:m.revision,variant:{...m.variants[0],power30MinKw:54,status:'verified',sourceUrl:'https://example.com/approval'}},owner);
  assert.equal(changed.variants[0].power30MinKw,54);assert.equal((await readModel(id))!.revision,changed.revision);
  assert.equal((await getJsonStorage().readJson<any>(changed.previousKey!,null)).variants[0].power30MinKw,undefined);
  await assert.rejects(()=>editModel(id,{revision:m.revision,variant:m.variants[0]},owner),EncyclopediaConflict);
  await assert.rejects(()=>editModel(id,{revision:changed.revision,variant:{...changed.variants[0],id:undefined}},owner),/уже есть/);
  await assert.rejects(()=>createModel({make:'TOYOTA',model:'Corolla'},owner),/уже есть/);
  const created=await createModel({make:'New',model:'Model'},owner);assert.equal((await readEncyclopedia())!.models.length,2);assert.equal((await readModel(created.id))!.variants.length,0);
 }finally{process.chdir(cwd);if(oldDriver===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=oldDriver;await fs.rm(root,{recursive:true,force:true});}
});
test('input validation and Excel export keep unknowns empty and neutralize formulas',()=>{
 assert.throws(()=>cleanVariant({year:2026.5}),/Год/);assert.throws(()=>cleanVariant({power30MinKw:-1}),/30-мин/);assert.throws(()=>cleanVariant({status:'verified'}),/источник/);assert.throws(()=>cleanVariant({sourceUrl:'javascript:alert(1)'}),/ссылку/);
 assert.equal(cleanVariant({power30MinKw:'54,5'}).power30MinKw,54.5);assert.equal(csvCell('=HYPERLINK("x")'),'"\'=HYPERLINK(""x"")"');
 const b=createSnapshotBuilder(at);b.add(car);const csv=modelCsv([...b.models.values()][0]);assert.ok(csv.includes('Toyota'));assert.ok(!csv.includes('undefined'));assert.ok(csv.includes(';"";'));
});
