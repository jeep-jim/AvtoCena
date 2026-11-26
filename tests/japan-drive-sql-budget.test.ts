import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {japanDriveSql} from '../apps/web/lib/catalog/japan-drive';
import {ajesQuery,ajesSourceCacheSql} from '../apps/web/lib/catalog/ajes-query';
import {ajesQueryCacheLocation} from '../apps/web/lib/catalog/ajes-query-cache';
import {japanVehicleSqlExclusion} from '../apps/web/lib/catalog/japan-vehicle-policy';
import {heavyVehicleFamilies,heavyVehicleSqlExclusion} from '../apps/web/lib/catalog/heavy-vehicle-families';
import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';
import {ajesErrorResponse} from '../apps/web/lib/catalog/ajes-error-response';
import {japanChassisDriveRows,lookupJapanChassisDrive} from '../apps/web/lib/encyclopedia/japan-chassis-drive';
import {stepwgnOwnerSql} from '../apps/web/lib/catalog/japan-owner-specifications';
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
 // The ordinary wire is compact too; its retained identity keeps the old predicate.
 assert.ok(ajesQuery({}).sql.includes(heavyVehicleSqlExclusion(false,false,true)));
 assert.ok(ajesSourceCacheSql(ajesQuery({}).sql).includes(heavyVehicleSqlExclusion()));
});
test('ordinary 48-row pages and every aggregate fit the URI budget with one exact source WHERE and retained identity',t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-26T12:00:00.000Z')});
 const compact=heavyVehicleSqlExclusion(false,false,true),full=heavyVehicleSqlExclusion();
 const where=(sql:string)=>sql.slice(sql.indexOf(' where ')).split(/ (?:group|order) by /)[0];
 const filters=[{},
  {fuel:'petrol'},
  {make:'TOYOTA',model:'COROLLA',fuel:'petrol',yearFrom:2014,yearTo:2026,engineTo:2000,mileageTo:100000,transmission:'automatic',auctionGrade:'3.5|4',color:'white'},
  {drive:'awd',fuel:'diesel',yearFrom:2014,engineTo:3000},
  {chassis:'LA350A',lotNumber:'002910',yearFrom:2008,yearTo:2019},
 ];
 for(const table of ['stats','main'] as const)for(const filter of filters)for(const page of [1,2,1000000]){
  const input={table,...filter,page,pageSize:48},list=ajesQuery(input).sql;
  assert.match(list,new RegExp(`limit ${(page-1)*48},48$`));
  for(const aggregate of [undefined,'count','models','makes','colors'] as const){
   const sql=ajesQuery({...input,aggregate}).sql,bytes=new URLSearchParams({sql}).toString().length;
   assert.ok(bytes<6000,`${table}/${aggregate||'list'}/${page}: ${bytes}`);
   assert.ok(sql.includes(compact));assert.equal(sql.includes(full),false);
   assert.doesNotMatch(sql,/concat_ws/i);
   assert.equal(where(sql),where(list),'list, directory and proof COUNT use identical source predicates');
   assert.equal(ajesSourceCacheSql(sql),sql.replace(compact,full).replace(japanVehicleSqlExclusion(),japanVehicleSqlExclusion(true)),'only equivalent SQL spelling changes in the retained key');
  }
 }
 const plain=ajesSourceCacheSql(ajesQuery({table:'stats',page:1,pageSize:48}).sql);
 const count=ajesSourceCacheSql(ajesQuery({table:'stats',aggregate:'count'}).sql);
 assert.equal(ajesQueryCacheLocation(plain).hash,'f308fb65af396c45aaa85ceb950a364f4af08f1344dbd9e9e8cc173a8ccbbf6a','same plain48 key as the pre-compaction candidate');
 assert.equal(ajesQueryCacheLocation(plain).key,'catalog/partner-cache/ajes/queries/101.json');
 assert.equal(ajesQueryCacheLocation(count).hash,'03c3e2e37e562fbc65b734d857e5dfe1296574b1303b802c2ce6439d3e689d0f');
 assert.equal(ajesQueryCacheLocation(count).key,'catalog/partner-cache/ajes/queries/counts/overall.json');
 assert.notEqual(ajesQueryCacheLocation(ajesSourceCacheSql(ajesQuery({aggregate:'count',fuel:'petrol'}).sql)).key,ajesQueryCacheLocation(count).key);
});
test('compact ordinary requests reuse the existing full-SQL list and COUNT without a supplier read',async()=>{
 const page={table:'stats' as const,page:1,pageSize:48},count={table:'stats' as const,aggregate:'count' as const};
 const pageSql=ajesSourceCacheSql(ajesQuery(page).sql),countSql=ajesSourceCacheSql(ajesQuery(count).sql),observedAt=new Date().toISOString();
 const saved={schemaVersion:2,items:[{id:'retained-plain',table:'stats'}],page:1,pageSize:48,received:48,rejected:0,observedAt,stale:false};
 const total={items:[],page:1,pageSize:1,received:1,rejected:0,observedAt,stale:false,total:660813};
 const reads:string[]=[];
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},
  reserve:async()=>{assert.fail('a fresh exact saved result must not reserve a supplier request');},
  fetcher:async()=>{assert.fail('a fresh exact saved result must not fetch the supplier');},
  readQuery:async sql=>{reads.push(sql);return sql===pageSql?saved:sql===countSql?total:null;}});
 assert.deepEqual(await client.read(page,'203.0.113.20'),saved);
 assert.deepEqual(await client.read(count,'203.0.113.20'),total);
 assert.deepEqual(reads,[pageSql,countSql]);
});
test('wire list and exact empty COUNT never execute the prior function spelling, while their proof hashes stay unchanged',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-26T15:00:00.000Z')});
 const queries:string[]=[];
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},fetcher:async url=>{
  const sql=new URL(String(url)).searchParams.get('sql')!;queries.push(sql);assert.doesNotMatch(sql,/concat_ws/i);assert.ok(new URLSearchParams({sql}).toString().length<6000);
  return Response.json(sql.startsWith('select count(*)')?[{total:0}]:[]);
 }});
 const input={table:'stats' as const,page:1,pageSize:48},result=await client.read(input,'203.0.113.20');
 assert.deepEqual(queries,[ajesQuery(input).sql,ajesQuery({...input,aggregate:'count'}).sql]);assert.deepEqual(result.items,[]);assert.equal(result.stale,false);
 assert.equal(result.emptyPageEvidence.sourceQueryHash,'f308fb65af396c45aaa85ceb950a364f4af08f1344dbd9e9e8cc173a8ccbbf6a');
 assert.equal(result.emptyPageEvidence.countQueryHash,'03c3e2e37e562fbc65b734d857e5dfe1296574b1303b802c2ce6439d3e689d0f');
});
test('Japan power lists and counts fit the supplier URI budget without losing owner power rules',()=>{
 for(const table of ['stats','main'] as const)for(const aggregate of [undefined,'count'] as const)for(const power of [{powerTo:160},{powerFrom:100},{powerFrom:100,powerTo:160}]){
  const sql=ajesQuery({table,aggregate,...power}).sql;
  const bytes=new URLSearchParams({sql}).toString().length;
  assert.ok(bytes<6000,`${table}/${aggregate}: ${bytes}`);
  assert.ok(sql.includes(heavyVehicleSqlExclusion(false,false,true)));
  assert.match(stepwgnOwnerSql(),/RP\[58\]/);
  assert.doesNotMatch(sql,/pw\s*(?:>=|<=|>|<)/i);
 }
 // Neither Japanese auction table may use supplier PW as a specification filter.
 for(const table of ['stats','main'] as const){
  assert.doesNotMatch(ajesQuery({table,powerTo:160}).sql,/pw\s*(?:>=|<=|>|<)/i);
  assert.ok(ajesSourceCacheSql(ajesQuery({table}).sql).includes(heavyVehicleSqlExclusion()));
 }
 for(const table of ['china','korea'])assert.throws(()=>ajesQuery({table,powerTo:160}),/ajes_invalid_query/);
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
