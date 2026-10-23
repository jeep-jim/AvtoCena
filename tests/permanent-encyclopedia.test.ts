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

test('mixed source spelling gives one fuel filter and correct Russian counts',async()=>{
 const {displayValue,fuelFilterKey,counted}=await import('../apps/web/lib/encyclopedia/schema');
 const {summarize}=await import('../apps/web/lib/encyclopedia/records');
 assert.equal(displayValue('Petrol'),'Бензин');assert.equal(displayValue('Electric'),'Электро');assert.equal(displayValue('other_hybrid'),'Гибрид');
 assert.equal(fuelFilterKey('Petrol hybrid'),'hybrid');assert.equal(counted(191,'make'),'191 марка');assert.equal(counted(33,'variant'),'33 модификации');
 const b=createSnapshotBuilder(at);b.add({...car,fuel:'Electric',powerHp:200});b.add({...car,fuel:'electric',powerHp:201});const summary=summarize([...b.models.values()][0],'test');assert.deepEqual(summary.fuels,['electric']);assert.equal(summary.needs30,2);
});

test('CSV download is blocked even by direct URL and returns no data stream',async()=>{
 const {GET}=await import('../apps/web/app/api/encyclopedia/export/route');
 const response=await GET();assert.equal(response.status,403);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Content-Disposition'),null);assert.deepEqual(await response.json(),{error:'Выгрузка базы недоступна.'});
});

test('encyclopedia model identity and discovery are independent of country',async()=>{
 const {filterModels}=await import('../apps/web/lib/encyclopedia/query');
 const {summarize}=await import('../apps/web/lib/encyclopedia/records');
 const b=createSnapshotBuilder(at);b.add(car);b.add({...car,market:'japan'});
 assert.equal(b.models.size,1);const record=[...b.models.values()][0];
 assert.equal(record.variants.length,1);assert.deepEqual(record.variants[0].markets,['china','japan']);
 const models=[summarize(record,'test')];
 assert.deepEqual(filterModels(models,{market:'korea'}),models,'legacy market URLs cannot hide a model');
 assert.deepEqual(filterModels(models,{make:'Toyota',year:'2021'}),models);
 assert.deepEqual(filterModels(models,{make:'Toyota',year:'2022'}),[],'technical filters still apply');
});

test('encyclopedia hides non-car records without deleting revisions; mixed makes retain cars',async()=>{
 const {isEncyclopediaCar}=await import('../apps/web/lib/encyclopedia/scope');
 for(const [make,model] of [['Harley-Davidson','Sportster'],['Yamaha','R1'],['KTM','1300R'],['Brabus','1300 R - KTM 1300'],['Isuzu','NQR'],['Toyota','Fork lift'],['Mitsubishi','Fuso Rosa']])assert.equal(isEncyclopediaCar({make,model}),false,`${make} ${model}`);
 for(const [make,model] of [['KTM','X-Bow'],['Brabus','G800'],['Isuzu','D-Max'],['MAN','TGE'],['Honda','Civic'],['Suzuki','Jimny']])assert.equal(isEncyclopediaCar({make,model}),true,`${make} ${model}`);
 const cwd=process.cwd(),root=await fs.mkdtemp(path.join(os.tmpdir(),'encyclopedia-scope-')),oldDriver=process.env.JSON_STORAGE_DRIVER;
 try{
  process.chdir(root);process.env.JSON_STORAGE_DRIVER='local';await fs.mkdir(path.join(root,'data'));
  const b=createSnapshotBuilder(at);b.add(car);b.add({...car,make:'Yamaha',model:'R1'});b.add({...car,make:'KTM',model:'X-Bow'});
  const manifest=await publishSnapshot(getJsonStorage(),b,'scope',0,at),hidden=manifest.models.find(x=>x.make==='Yamaha')!;
  assert.equal((await readEncyclopedia())!.models.length,2);assert.equal(await readModel(hidden.id),null);
  assert.ok(await getJsonStorage().readJson(hidden.key,null),'archived revision retained');
  await assert.rejects(()=>createModel({make:'Yamaha',model:'R1'},owner),/только автомобили/);
  const current=(await readModel(manifest.models.find(x=>x.make==='Toyota')!.id))!;
  await assert.rejects(()=>editModel(current.id,{action:'model',revision:current.revision,make:'Harley-Davidson',model:'Sportster'},owner),/только автомобили/);
  await editModel(current.id,{action:'model',revision:current.revision,make:'Toyota',model:'Corolla'},owner);
  assert.equal((await getJsonStorage().readJson<any>(MANIFEST,null)).models.length,3,'editing visible records does not erase hidden originals');
 }finally{process.chdir(cwd);if(oldDriver===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=oldDriver;await fs.rm(root,{recursive:true,force:true});}
});

test('manual edit preserves server ASTRA identities and rejects client provenance substitution',async()=>{
 const cwd=process.cwd(),root=await fs.mkdtemp(path.join(os.tmpdir(),'astra-edit-')),oldDriver=process.env.JSON_STORAGE_DRIVER;
 try{
  process.chdir(root);process.env.JSON_STORAGE_DRIVER='local';await fs.mkdir(path.join(root,'data'));
  const b=createSnapshotBuilder(at);b.add(car);const record=[...b.models.values()][0];
  Object.assign(record.variants[0],{astraIdentity:{approval:'e6*0437',variant:'official'},astraEvidence:{manufactureYears:[2021],values:{powerKw:89}},researchEvidence:{batchId:'old-proof',fields:['powerKw'],values:{powerKw:89}}});
  const manifest=await publishSnapshot(getJsonStorage(),b,'astra-test',0,at),m=(await readModel(manifest.models[0].id))!;
  const changed=await editModel(m.id,{revision:m.revision,variant:{...m.variants[0],powerKw:90,astraIdentity:{approval:'forged'},astraEvidence:{values:{powerKw:90}}}},owner);
  assert.deepEqual(changed.variants[0].astraIdentity,m.variants[0].astraIdentity);
  assert.deepEqual(changed.variants[0].astraEvidence,m.variants[0].astraEvidence);
  assert.equal(changed.variants[0].powerKw,90);
  assert.equal((changed.variants[0] as any).researchEvidence,undefined);
  assert.ok(changed.variants[0].manualEditedAt);
 }finally{process.chdir(cwd);if(oldDriver===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=oldDriver;await fs.rm(root,{recursive:true,force:true});}
});
