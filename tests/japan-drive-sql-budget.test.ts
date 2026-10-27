import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {japanDriveSql} from '../apps/web/lib/catalog/japan-drive';
import {ajesQuery} from '../apps/web/lib/catalog/ajes-query';
import {heavyVehicleFamilies,heavyVehicleSqlExclusion} from '../apps/web/lib/catalog/heavy-vehicle-families';
import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';
import {ajesErrorResponse} from '../apps/web/lib/catalog/ajes-error-response';
import {japanChassisDriveRows,lookupJapanChassisDrive} from '../apps/web/lib/encyclopedia/japan-chassis-drive';
function database(){
 const db=new DatabaseSync(':memory:');
 db.function('regexp',(pattern,value)=>value===null?null:Number(new RegExp(String(pattern),'i').test(String(value))));
 return db;
}
test('compact drive SQL selects exact chassis, explicit tokens and source overrides before pagination',()=>{
 const db=database();
 db.exec('create table cars(id integer,marka_name text,model_name text,year integer,kuzov text,grade text,priv text)');
 const rows:[string,string,string|null,string|null,string|null][]=[
  ['HONDA','DBA-RE4',null,null,'awd'],['HONDA','RE3','',null,'fwd'],
  ['HONDA','RE4','2WD',null,null],['HONDA','RE4','4WD FWD',null,null],
  ['HONDA','RE4','2WD AWD',null,null],['HONDA','RE4','AWD','FF','fwd'],
  ['SUZUKI','HA36S','',null,null],['SUZUKI','HA36S','SPORT-4WD',null,'awd'],
  ['SUZUKI','HA36S','4WD/FWD',null,null],['SUZUKI','HA36S','A4WD',null,null],
  ['OTHER','RE4','',null,null],['OTHER','NONE','(FR)',null,'rwd'],
  ['OTHER','NONE','2WD',null,null],['OTHER','NONE','2WD','FULLTIME4WD','awd'],
  ['HONDA','XRE4','',null,null],['HONDA','RE4X','',null,null],
 ];
 const insert=db.prepare('insert into cars values(?,?,?,?,?,?,?)');
 rows.forEach(([make,code,grade,priv],id)=>insert.run(id,make,'TEST',2023,code,grade,priv));
 for(const selection of ['awd','fwd','rwd','awd|fwd','fwd|rwd','awd|fwd|rwd']){
  const result=db.prepare('select id from cars where '+japanDriveSql(selection)+' order by id').all().map(r=>r.id);
  const expected=rows.flatMap((row,id)=>row[4]&&selection.split('|').includes(row[4])?[id]:[]);
  assert.deepEqual(result,expected,selection);
 }
 db.close();
});
test('compact truck predicate preserves every existing family and separator boundary',()=>{
 const db=database();db.exec('create table cars(id integer,marka_name text,model_name text)');
 const insert=db.prepare('insert into cars values(?,?,?)');let id=0;
 const models=[...new Set(heavyVehicleFamilies.flatMap(g=>[...g.models]))];
 for(const make of [...heavyVehicleFamilies.map(g=>g.make),'FORD','SUZUKI'])for(const model of [...models,'HIACE','CARRY'])for(const suffix of ['',' X','-X','/X','X','_X'])insert.run(id++,make,model+suffix);
 for(const legacy of [false,true])for(const beforeLight of [false,true]){
  const read=(compact:boolean)=>db.prepare('select id from cars where '+heavyVehicleSqlExclusion(legacy,beforeLight,compact)+' order by id').all();
  assert.deepEqual(read(true),read(false));
 }
 db.close();
});
test('every reviewed Porsche type filters without supplier drive, retaining shared types and source conflicts',()=>{
 const db=database();db.exec('create table cars(id integer,marka_name text,model_name text,year integer,kuzov text,grade text,priv text)');
 const rows=japanChassisDriveRows().filter(r=>r.make==='Porsche');
 assert.equal(rows.length,43);assert.equal(rows.filter(r=>r.drives.length===1).length,40);
 const insert=db.prepare('insert into cars values(?,?,?,?,?,?,?)');
 rows.forEach((r,i)=>insert.run(i,'PORSCHE','TEST',2023,'3BA-'+r.chassisCode,'',''));
 for(const drive of ['awd','fwd','rwd']){
  const selected=db.prepare('select id from cars where '+japanDriveSql(drive)+' order by id').all().map(r=>r.id);
  assert.deepEqual(selected,rows.flatMap((r,i)=>r.drives.length===1&&r.drives[0]===drive?[i]:[]));
 }
 for(const code of ['992L30','G2ML1','G2NL1','35','53','EACA'])assert.equal(lookupJapanChassisDrive('Porsche',code),undefined);
 db.close();
});
test('single drivetrain queries remain well below a standard 8 KB request line',()=>{
 for(const drive of ['awd','fwd','rwd']){
  const bytes=new URLSearchParams({sql:ajesQuery({drive}).sql}).toString().length;
  assert.ok(bytes<6000,drive+': '+bytes);
 }
 // Unfiltered cached queries retain their exact old truck predicate.
 assert.ok(ajesQuery({}).sql.includes(heavyVehicleSqlExclusion()));
});
test('supplier URI limit is classified without leaking its response or credentials',async()=>{
 const client=createAjesClient({password:()=> 'private-fixture',assertEnabled:async()=>{},reserve:async()=>{},fetcher:async()=>new Response('private provider body',{status:414})});
 let failure:unknown;try{await client.read({drive:'awd'},'127.0.0.1');}catch(error){failure=error;}
 assert.deepEqual(ajesErrorResponse(failure),{status:503,body:{ok:false,error:'japan_search_unavailable',reason:'query_too_large'}});
});

test('all saved chassis groups agree between displayed drive and SQL before LIMIT/count',()=>{
 const db=database();db.exec('create table cars(id integer,marka_name text,model_name text,year integer,kuzov text,grade text,priv text)');
 const rows=japanChassisDriveRows();const insert=db.prepare('insert into cars values(?,?,?,?,?,?,?)');
 rows.forEach((r,i)=>insert.run(i,r.make.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace('MERCEDES-BENZ','MERCEDES BENZ'),'TEST',2023,'DBA-'+r.chassisCode,'',''));
 for(const selection of ['awd','fwd','rwd','awd|fwd|rwd']){
  const expected=rows.flatMap((r,i)=>{const drive=lookupJapanChassisDrive(r.make,r.chassisCode);return drive&&selection.split('|').includes(drive)?[i]:[];});
  const query=' from cars where '+japanDriveSql(selection);
  assert.equal(db.prepare('select count(*) as n'+query).get()!.n,expected.length);
  assert.deepEqual(db.prepare('select id'+query+' order by id limit 24 offset 24').all().map(r=>r.id),expected.slice(24,48));
 }
 assert.ok(rows.length>300);db.close();
});
