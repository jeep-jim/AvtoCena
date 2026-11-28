import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {buildJapanPowerCandidatePlan,resolveJapanSourceSelection,japanSourceSelectionSql} from '../apps/web/lib/catalog/japan-source-selection';
import {japanSourceHeavyCandidateSql} from '../apps/web/lib/catalog/japan-source-selection-sql';
import {ajesQuery,ajesLot,ajesSourceCacheSql} from '../apps/web/lib/catalog/ajes-query';
import {heavyVehicleFamilies,heavyVehicleSqlExclusion} from '../apps/web/lib/catalog/heavy-vehicle-families';
import {japanHeavyVehicleSqlExclusion} from '../apps/web/lib/catalog/japan-vehicle-policy';
import type {CalculationIndex} from '../apps/web/lib/encyclopedia/calculation-index';

const editorial={revision:'e1',entries:{}};
const index={version:1,digest:'d1',manifestDigest:'m1',createdAt:'2026-11-28T00:00:00Z',models:{
 'audi:a4':[
  {make:'Audi',model:'A4',year:2020,values:{powerHp:150}},
  {make:'Audi',model:'A4',year:2021,values:{powerHp:200}},
  {make:'Audi',model:'A4',year:2020,values:{powerKw:110}},
 ],
 '@astra-power30:audi:a4':[{year:0,values:{power30MinKw:100}}],
}} as unknown as CalculationIndex;

test('power plan retains only annual hp donors in range and the owner policy',()=>{
 const plan=buildJapanPowerCandidatePlan({powerTo:160,index,editorial});
 assert.equal(plan.complete,true);assert.equal(plan.ownerStepwgn,true);
 assert.deepEqual(plan.models,[{modelKey:'audi:a4',make:'Audi',model:'A4',year:2020}]);
 const high=buildJapanPowerCandidatePlan({powerFrom:170,powerTo:210,index,editorial});
 assert.equal(high.ownerStepwgn,false);assert.equal(high.models[0].year,2021);
});
test('complete wire directory keeps every canonical spelling without manufacturing aliases',()=>{
 const plan=buildJapanPowerCandidatePlan({powerTo:160,index,editorial});
 const sourceModels=[{make:'AUDI',model:'A4'},{make:'AUDI',model:'A 4'},{make:'AUDI',model:'A-4'},
  {make:'ＡＵＤＩ',model:'Ａ４'},{make:'HONDA',model:'STEP WGN'},{make:'TOYOTA',model:'A4'}];
 const resolved=resolveJapanSourceSelection({power:plan,sourceModels,directoryComplete:true});
 assert.equal(resolved.complete,true);assert.equal(resolved.selection!.power!.models.length,4);
 const known=japanSourceSelectionSql(resolved.selection!,'k'),unknown=japanSourceSelectionSql(resolved.selection!,'u');
 for(const name of ['A4','A 4','A-4','Ａ４','STEP WGN'])assert(known.includes(`'%${name}%'`));
 assert(known.includes('year=2020'));assert(!known.includes('year=2021'));assert(!known.includes("marka_name like '%TOYOTA%'"));
 assert(known.includes("pw>=0 and pw<=160 and pw!='' and pw!='0' and pw not like '%,%'"));
 assert(!known.includes('pw is null'));assert(!known.includes('pw+'));assert(!known.includes('pw*'));assert(!known.includes('regexp'));
 assert.equal(unknown,'(1=1)');
});
test('a stale or missing directory cannot establish complete local override coverage',()=>{
 const power=buildJapanPowerCandidatePlan({powerTo:160,index,editorial});
 const result=resolveJapanSourceSelection({power,sourceModels:[],directoryComplete:false});
 assert.equal(result.complete,false);assert.equal(result.selection,null);assert(result.unresolved.includes('source_model_directory_incomplete'));
});
test('an unsupported exact entity spelling is reported, never silently removed or expanded to all models',()=>{
 const power=buildJapanPowerCandidatePlan({powerTo:160,index,editorial});
 const result=resolveJapanSourceSelection({power,sourceModels:[{make:'AUDI',model:'A&#52;'}],directoryComplete:true});
 assert.equal(result.complete,false);assert.equal(result.selection,null);assert(result.unresolved.includes('source_model_spelling_unsupported'));
});
test('no index means no annual hp contribution and no extra directory needed outside owner range',()=>{
 const power=buildJapanPowerCandidatePlan({powerFrom:170,powerTo:210,index:null,editorial});
 const result=resolveJapanSourceSelection({power,sourceModels:[],directoryComplete:false});
 assert.equal(result.complete,true);assert.deepEqual(result.selection!.power!.models,[]);
});
test('body cohorts use the same exact alias resolution and combine with power, not a page-local sort',()=>{
 const power=buildJapanPowerCandidatePlan({powerTo:160,index,editorial});
 const body={models:[{modelKey:'audi:a4',make:'Audi',model:'A4',year:2020}],ids:['saved-1'],sourceBody:{field:'BODY_TYPE' as const,labels:['SUV','Кроссовер']},pickupCandidates:false,complete:true,unresolved:[]};
 const result=resolveJapanSourceSelection({power,body,sourceModels:[{make:'AUDI',model:'A 4'}],directoryComplete:true});
 const sql=japanSourceSelectionSql(result.selection!,'k');
 assert.deepEqual(result.selection!.body!.ids,['saved-1']);assert(sql.includes("id in ('saved-1')"));
 assert(sql.includes("id regexp '[^A-Za-z0-9_-]'"),'noncanonical raw IDs retain entity/NFKC/trim spellings');
 assert(!sql.includes('(1=1)'),'an exact edited identity must not erase the source selection');
 const withoutManual=japanSourceSelectionSql({...result.selection!,body:{...result.selection!.body!,ids:[]}},'k');
 assert(withoutManual.includes("body_type is not null and body_type!=''"));assert(withoutManual.includes(') and ('));
 assert(!sql.includes('body_type) in'),'source body aliases cannot silently narrow NFKC/whitespace variants');
});
test('missing body schema keeps representable known candidates explicitly incomplete',()=>{
 const body={models:[{modelKey:'audi:a4',make:'Audi',model:'A4',year:2020}],ids:['saved-1'],pickupCandidates:false,
  complete:false,unresolved:['body_source_schema_unobserved']};
 const result=resolveJapanSourceSelection({body,sourceModels:[{make:'AUDI',model:'A 4'}],directoryComplete:true});
 assert.equal(result.complete,false);assert(result.selection);assert.deepEqual(result.unresolved,['body_source_schema_unobserved']);
 const sql=japanSourceSelectionSql(result.selection);
 assert(sql.includes("id in ('saved-1')"));assert(sql.includes("id regexp '[^A-Za-z0-9_-]'"));
 assert(!sql.includes('(1=1)'),'manual normalization is retained without a source-wide candidate');
 const modelOnly=japanSourceSelectionSql({...result.selection!,body:{...result.selection!.body!,ids:[]}});
 assert(modelOnly.includes("model_name like '%A 4%'"));assert(!modelOnly.includes('body_type'));
 const noIndex=resolveJapanSourceSelection({body:{...body,models:[],unresolved:['body_source_schema_unobserved','body_encyclopedia_unavailable']},sourceModels:[],directoryComplete:false});
 assert.equal(noIndex.complete,false);assert(noIndex.selection);
 assert(japanSourceSelectionSql(noIndex.selection).includes("id in ('saved-1')"));
 const invalid=resolveJapanSourceSelection({body:{...body,unresolved:['body_evidence_identity_invalid']},sourceModels:[{make:'AUDI',model:'A 4'}],directoryComplete:true});
 assert.equal(invalid.selection,null);
});
test('typed SQL descriptors reject injected fields, invalid ids, phases and raw SQL names',()=>{
 const power=buildJapanPowerCandidatePlan({powerTo:160,index:null,editorial});
 const {selection}=resolveJapanSourceSelection({power,sourceModels:[],directoryComplete:true});
 assert.throws(()=>japanSourceSelectionSql(selection!),/ajes_invalid_query/);
 assert.throws(()=>japanSourceSelectionSql({...selection!,sql:'1=1'} as any,'k'),/ajes_invalid_query/);
 assert.throws(()=>japanSourceSelectionSql({...selection!,power:{...selection!.power!,ids:["x' or 1=1"]}},'k'),/ajes_invalid_query/);
 assert.throws(()=>japanSourceSelectionSql({...selection!,power:{...selection!.power!,ids:123}} as any,'k'),/ajes_invalid_query/);
 assert.throws(()=>japanSourceSelectionSql({...selection!,power:{...selection!.power!,models:[{make:'AUDI',model:"A4'",years:[2020]}]}},'k'),/ajes_invalid_query/);
 assert.throws(()=>japanSourceSelectionSql({...selection!,power:{...selection!.power!,models:[{make:"AUDI' OR 1=1",model:'A4',years:[2020]}]}},'k'),/ajes_invalid_query/);
 assert.throws(()=>japanSourceSelectionSql({...selection!,power:{...selection!.power!,from:0}},'k'),/ajes_invalid_query/);
});
test('local-only body scope intersects annual power exceptions while manual clauses retain normalized identities',()=>{
 const selection:any={version:1,power:{from:1,to:160,models:[
  {make:'AUDI',model:'A4',years:[2020,2021]},{make:'TOYOTA',model:'POWER ONLY',years:[2020]},
 ],ids:['manual-power'],ownerModels:[]},body:{models:[{make:'AUDI',model:'A4',years:[2021,2022]}],ids:['manual-body'],pickupCandidates:false}};
 const before=JSON.stringify(selection),manual=japanSourceSelectionSql(selection,'k');
 assert(manual.includes("id in ('manual-body','manual-power')"));assert(!manual.includes('(1=1)'));
 const unedited={...selection,power:{...selection.power,ids:[]},body:{...selection.body,ids:[]}},sql=japanSourceSelectionSql(unedited,'k');
 assert(!sql.includes('POWER ONLY'));assert(!sql.includes('2020'));assert(sql.includes("model_name like '%A4%' and year=2021"));
 assert(sql.includes('pw>=0 and pw<=160'));
 assert.equal(JSON.stringify(selection),before,'SQL compilation does not mutate cursor identity');
 for(const patch of [{sourceBody:{field:'BODY_TYPE',labels:['suv']}},{pickupCandidates:true}]){
  const broad=japanSourceSelectionSql({...unedited,body:{...unedited.body,...patch}},'k');assert(broad.includes('POWER ONLY'));
 }
});
test('year compression preserves gaps and uses a range only for consecutive years',()=>{
 const base={version:1 as const,body:{models:[{make:'AUDI',model:'A4',years:[2023,2021,2022,2020,2020]}],ids:[],pickupCandidates:false}};
 const compact=japanSourceSelectionSql(base);assert(compact.includes('year>=2020 and year<=2023'));
 const gaps=japanSourceSelectionSql({...base,body:{...base.body,models:[{make:'AUDI',model:'A4',years:[2020,2022,2023]}]}});
 assert(gaps.includes('year in (2020,2022,2023)'));assert(!gaps.includes('year>=2020'));
 const pair=japanSourceSelectionSql({...base,body:{...base.body,models:[{make:'AUDI',model:'A4',years:[2020,2021]}]}});
 assert(pair.includes('year in (2020,2021)'));
});
test('small model descriptors retain their make and year associations before broadening',()=>{
 const selection:any={version:1,power:{from:1,to:160,models:[
  {make:'AUDI',model:'COMMON',years:[2020,2022]},
  {make:'TOYOTA',model:'COMMON',years:[2020,2022]},
  {make:'HONDA',model:'OTHER',years:[2021]},
 ],ids:[],ownerModels:[{make:'HONDA',model:'STEP WGN'},{make:'HONDA',model:'STEPWGN'}]}};
 const before=JSON.stringify(selection),sql=japanSourceSelectionSql(selection,'k');
 assert(sql.includes("model_name like '%COMMON%' and year in (2020,2022)"));
 assert(sql.includes("model_name like '%OTHER%' and year=2021"));
 for(const make of ['AUDI','TOYOTA','HONDA'])assert(sql.includes(`marka_name like '%${make}%'`));
 assert(sql.includes("model_name like '%STEP WGN%' or model_name like '%STEPWGN%'"));
 assert.equal(JSON.stringify(selection),before);
});

test('source power grammar preserves the normalization namespace and leaves the lower bound to local filtering',()=>{
 const selection={version:1 as const,power:{from:100,to:160,models:[],ids:[],ownerModels:[]}};
 const known=japanSourceSelectionSql(selection,'k');
 assert.match(known,/pw>=0 and pw<=160/);
 assert.doesNotMatch(known,/pw>=100|regexp|trim\(|pw[+*]|%&%/);
 assert.equal(japanSourceSelectionSql(selection,'u'),'(1=1)','U must preserve every malformed or absent wire value');
 const withBody={...selection,body:{models:[],ids:['body-only'],pickupCandidates:false}};
 const unknownBody=japanSourceSelectionSql(withBody,'u');
 assert(unknownBody.includes("id in ('body-only')"));assert(unknownBody.includes("id regexp '[^A-Za-z0-9_-]'"));assert.doesNotMatch(unknownBody,/\bpw\b/);
});

test('exact-family source exclusion covers the complete existing make/model roster without suffix guesses',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('create table stats(marka_name text,model_name text)');
 const insert=db.prepare('insert into stats values (?,?)');
 for(const group of heavyVehicleFamilies)for(const model of group.models){insert.run(group.make,model);insert.run(group.make,model+' CUSTOM');}
 insert.run('TOYOTA','SIENTA');insert.run('HONDA','STEP WGN');
 const exclusion=japanSourceHeavyCandidateSql();
 assert.doesNotMatch(exclusion,/regexp|like/);
 const candidates=db.prepare(`select * from stats where ${exclusion}`).all();
 assert.equal(candidates.length,heavyVehicleFamilies.reduce((sum,group)=>sum+group.models.length,0)+2);
 assert(candidates.every(row=>String(row.model_name).endsWith(' CUSTOM')||['SIENTA','STEP WGN'].includes(String(row.model_name))));
});

test('a broad heavy-family suffix is only a source candidate and never becomes an admitted lot',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('create table stats(ID text,YEAR integer,AUCTION_TYPE integer,STATUS text,FINISH integer,MARKA_NAME text,MODEL_NAME text,AUCTION_DATE text,PW text)');
 const insert=db.prepare('insert into stats values (?,2023,2,\'Sold\',1000000,?,?,\'2026-11-28\',\'150\')');
 for(const [id,make,model] of [['exact','TOYOTA','COASTER'],['suffix','TOYOTA','COASTER PREMIUM'],['van','TOYOTA','SIENTA'],['owner','HONDA','STEP WGN']])insert.run(id,make,model);
 const selection={version:1 as const,power:{from:1,to:160,models:[],ids:[],ownerModels:[]}};
 const query=ajesQuery({table:'stats',sourceSelection:selection,sourcePhase:'k'});
 // Adapt only SQLite's varchar/numeric affinity; the production WHERE runs as
 // emitted. This fixture is not evidence of AJ server grammar acceptance.
 const sql=query.sql.replace(/\bpw\s*(>=|<=)\s*(\d+)/g,'cast(pw as real)$1$2');
 const candidates=db.prepare(sql).all();
 assert.deepEqual(candidates.map(row=>row.ID),['owner','suffix','van']);
 const admitted=candidates.map(row=>ajesLot(row,'stats',false)).filter(value=>value!==null);
 assert.deepEqual(admitted.map(value=>value.id),['owner','van']);
});

test('selection heavy scope stays distinct in cache while ordinary and drive predicates remain unchanged',()=>{
 const selection={version:1 as const,power:{from:1,to:160,models:[],ids:[],ownerModels:[]}};
 const coarse=japanSourceHeavyCandidateSql(),ordinary=japanHeavyVehicleSqlExclusion(),drive=heavyVehicleSqlExclusion(false,false,true);
 for(const phase of ['k','u'] as const){
  const sql=ajesQuery({table:'stats',sourceSelection:selection,sourcePhase:phase}).sql;
  assert(sql.includes(coarse));assert(!sql.includes(ordinary));assert(!sql.includes(drive));assert.doesNotMatch(sql,/regexp/);
  const cached=ajesSourceCacheSql(sql);assert(cached.includes(coarse));assert(!cached.includes(heavyVehicleSqlExclusion()),'coarse candidate rows cannot share the exact-family cache');
  const counted=ajesQuery({table:'stats',sourceSelection:selection,sourcePhase:phase,aggregate:'count'}).sql;
  assert(counted.includes(coarse));assert.doesNotMatch(counted,/regexp/);
 }
 assert(ajesQuery({table:'stats'}).sql.includes(ordinary));
 assert(ajesQuery({table:'stats',drive:'awd'}).sql.includes(drive));
});

for(const count of [25,50,100])test(`${count} model cohorts fit the shared SQL budget without losing a raw candidate`,t=>{
 const makes=['TOYOTA','HONDA','NISSAN','SUZUKI','MAZDA','SUBARU','MITSUBISHI','DAIHATSU','AUDI','BMW'];
 const models=Array.from({length:count},(_,i)=>({make:makes[i%makes.length],model:'MODEL '+Math.floor(i/makes.length),years:[2008+i%19]}));
 const selection={version:1 as const,power:{to:160,models,ids:[],ownerModels:[]}};
 const scope={table:'stats' as const,powerTo:160,sourceSelection:selection,sourcePhase:'k' as const};
 const where=(sql:string)=>sql.split(' where ')[1].split(' order by ')[0];
 const variants=[{}, {page:1000000,pageSize:48}, {sort:'auctionDateDesc,mileageDesc,totalRubDesc,year'},
  {aggregate:'count' as const}, {aggregate:'count' as const,countIdentity:true as const}];
 const emitted=variants.map(patch=>ajesQuery({...scope,...patch}).sql);
 for(const sql of emitted){
  assert(new URLSearchParams({sql}).toString().length<=6000,'one fixed reserve covers both LIST and COUNT');
  assert.equal(where(sql),where(emitted[0]),'page, sort and count projection must not choose a different candidate set');
  assert.doesNotMatch(sql,/\bpw\s+regexp|trim\(|replace\(/i);
 }
 if(count===25)assert(where(emitted[0]).includes('marka_name like'),'make restriction is kept while it fits');
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.function('regexp',(pattern:any,value:any)=>value==null?null:Number(new RegExp(String(pattern),'iu').test(String(value))));
 db.exec('create table stats(id text,year integer,auction_type integer,status text,finish integer,marka_name text,model_name text,auction_date text,pw text,mileage integer)');
 const insert=db.prepare("insert into stats values(?,?,2,'Sold',1000000,?,?,'2026-11-28','400',1000)");
 models.forEach((row,i)=>insert.run('cohort-'+i,row.years[0],' '+row.make+' ', '\t'+row.model+'　'));
 const sql=where(emitted[0]).replace(/\bpw\s*(>=|<=|>|<)\s*(\d+)/g,'cast(pw as real)$1$2');
 const actual=db.prepare('select id from stats where '+sql+' order by id').all().map(row=>row.id);
 assert.deepEqual(actual,models.map((_,i)=>'cohort-'+i).sort());
});

test('tiny budgets broaden complete validated model sets, including Unicode code-point prefixes',t=>{
 const names=['𝟙XX','ＡＢ','АБ','A_B','1','.','A+B','X/Y'];
 const models=Array.from({length:40},(_,i)=>({make:'FIXTURE '+i,model:names[i%names.length]+i,years:[2023]}));
 const selection={version:1 as const,power:{to:160,models,ids:[],ownerModels:[]}};
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.function('regexp',(pattern:any,value:any)=>value==null?null:Number(new RegExp(String(pattern),'iu').test(String(value))));
 db.exec('create table stats(marka_name text,model_name text,year integer,pw text)');
 const insert=db.prepare("insert into stats values(?,?,2023,'400')");
 for(const row of models)insert.run(' '+row.make+' ', '\t'+row.model+'　');
 const compiled=[];
 for(const budget of [2000,800,350,0]){
  const sql=japanSourceSelectionSql(selection,'k',budget);compiled.push(sql);
  assert.doesNotMatch(sql,/\bpw\s+regexp|trim\(|replace\(/i);
  assert(sql==='(1=1)'||new URLSearchParams({sql}).toString().length-4<=budget);
  const sqlite=sql.replace(/\bpw\s*(>=|<=|>|<)\s*(\d+)/g,'cast(pw as real)$1$2');
  assert.equal(db.prepare('select count(*) as total from stats where '+sqlite).get()!.total,models.length);
 }
 assert(compiled.some(sql=>sql.includes('model_name like')),'the test exercises a compressed pattern stage before broad fallback');
 assert.equal(compiled.at(-1),'(1=1)');
 assert.throws(()=>japanSourceSelectionSql({...selection,power:{...selection.power,models:[{make:'BAD',model:"x'",years:[2023]}]}},'k',0),/ajes_invalid_query/,'a small budget never bypasses descriptor validation');
});

test('compact literal model candidates retain make/year identity and escape observed punctuation',t=>{
 const special=['A.4','A+B','X(Y)','A_B','A&B','X/Y','Ａ４','𝟙XX','АБ'];
 const names=[...Array.from({length:100},(_,i)=>'MODEL '+String(i).padStart(3,'0')),...special];
 const models=names.map(model=>({make:'FIXTURE',model,years:[2020,2022]}));
 const selection={version:1 as const,body:{models,ids:[],pickupCandidates:false}};
 const full=japanSourceSelectionSql(selection,undefined,100000),compact=japanSourceSelectionSql(selection,undefined,3000);
 assert.match(compact,/model_name regexp/);assert.match(compact,/marka_name like '%FIXTURE%'/);
 assert.match(compact,/year in \(2020,2022\)/);assert.doesNotMatch(compact,/1=1|\\/);
 assert(new URLSearchParams({sql:compact}).toString().length-4<=3000);
 assert.match(compact,/model_name like '%A_B%'/,'existing underscore wildcard semantics stay in LIKE');
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.function('regexp',(pattern:any,value:any)=>value==null?null:Number(new RegExp(String(pattern),'iu').test(String(value))));
 db.exec('create table stats(id integer primary key,marka_name text,model_name text,year integer)');
 const insert=db.prepare('insert into stats(marka_name,model_name,year) values(?,?,?)');
 for(const make of ['FIXTURE','OTHER'])for(const model of [...names,'A94','AB','XYY','UNRELATED','A\nB'])for(const year of [2019,2020,2021,2022]){
  insert.run(make,model,year);insert.run(' '+make+' ','\t'+model+'　',year);
 }
 const ids=(sql:string)=>db.prepare('select id from stats where '+sql+' order by id').all().map(row=>row.id);
 assert.deepEqual(ids(compact),ids(full),'compaction preserves the actual candidate relation, including negative make/year and punctuation cases');
});

test('factoring repeated make and year clauses preserves the full finite relation before broadening',t=>{
 const models=Array.from({length:60},(_,i)=>({make:'FIXTURE MAKE '+Math.floor(i/20),model:'MODEL '+i%20,years:[2008+i%10,2019+i%8]}));
 const selection={version:1 as const,body:{models,ids:[],pickupCandidates:false}};
 const full=japanSourceSelectionSql(selection,undefined,100000),compact=japanSourceSelectionSql(selection,undefined,3500);
 for(const make of ['FIXTURE MAKE 0','FIXTURE MAKE 1','FIXTURE MAKE 2'])assert(compact.includes(`marka_name like '%${make}%'`));
 assert(new URLSearchParams({sql:compact}).toString().length-4<=3500);assert.doesNotMatch(compact,/1=1/);
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.function('regexp',(pattern:any,value:any)=>value==null?null:Number(new RegExp(String(pattern),'iu').test(String(value))));
 db.exec('create table stats(id integer primary key,marka_name text,model_name text,year integer)');
 const insert=db.prepare('insert into stats(marka_name,model_name,year) values(?,?,?)');
 for(const make of ['FIXTURE MAKE 0','FIXTURE MAKE 1','FIXTURE MAKE 2','OTHER'])for(const model of [...new Set(models.map(row=>row.model)),'OTHER'])for(let year=2007;year<=2027;year++)insert.run(make,model,year);
 const ids=(sql:string)=>db.prepare('select id from stats where '+sql+' order by id').all().map(row=>row.id);
 assert.deepEqual(ids(compact),ids(full),'model/year orientation and shared tails do not mix cohorts');
});

test('compact source selection keeps one complete predicate across LIST, COUNT, sorts and continuation',()=>{
 const models=Array.from({length:100},(_,i)=>({make:'FIXTURE',model:'MODEL '+String(i).padStart(3,'0'),years:[2020,2022]}));
 const selection={version:1 as const,power:{to:160,models,ids:[],ownerModels:[]}};
 const query={table:'stats' as const,powerTo:160,sourceSelection:selection,sourcePhase:'k' as const};
 const variants=[{}, {page:1000000,pageSize:48}, {sort:'auctionDateDesc,mileageDesc,totalRubDesc,year'},
  {aggregate:'count' as const}, {aggregate:'count' as const,countIdentity:true as const}];
 const where=(sql:string)=>sql.split(' where ')[1].split(' order by ')[0];
 const queries=variants.map(patch=>ajesQuery({...query,...patch}).sql);
 for(const sql of queries){
  assert(new URLSearchParams({sql}).toString().length<=6000);
  assert.match(sql,/model_name regexp/);assert.match(sql,/marka_name like '%FIXTURE%'/);
  assert.doesNotMatch(sql,/\bpw\s+regexp/);assert.equal(where(sql),where(queries[0]));
 }
});
