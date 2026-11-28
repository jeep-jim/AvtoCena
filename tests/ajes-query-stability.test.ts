import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {ajesQuery,ajesSourceCacheSql,AJES_CENSUS_FIELDS,type AjesQuery} from '../apps/web/lib/catalog/ajes-query';
import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';
import {heavyVehicleFamilies,heavyVehicleSqlExclusion} from '../apps/web/lib/catalog/heavy-vehicle-families';
import {japanHeavyVehicleSqlExclusion,japanVehicleFamilySqlExclusion,japanVehicleFamilyCacheSqlExclusion} from '../apps/web/lib/catalog/japan-vehicle-policy';
import {japanSourceHeavyCandidateSql} from '../apps/web/lib/catalog/japan-source-selection-sql';
import {ajesQueryCacheLocation,readPreviousJapanPolicyRows} from '../apps/web/lib/catalog/ajes-query-cache';

test('non-drive searches restore grouped =/LIKE grammar within the existing URI budget for every source query kind',()=>{
 for(const table of ['stats','main'] as const)for(const aggregate of [undefined,'count','makes','models','colors'] as const)
 for(const filters of [{},{make:'MAZDA',model:'3'},{auctionGrade:'5',transmission:'automatic',fuel:'petrol',powerTo:160}]){
  const sql=ajesQuery({table,aggregate,...filters}).sql;
  assert.ok(sql.includes(japanHeavyVehicleSqlExclusion()));
  const {powerTo,...plainFilters}=filters as AjesQuery;
  const plain=ajesQuery({table,aggregate,...plainFilters}).sql;
  assert.doesNotMatch(sql,/\bregexp\b/i,'power selection retains the proven non-drive source grammar');
  assert.equal(sql,plain,'local power filtering reuses the same complete source candidates');
  const url=new URL('http://87.242.72.57/api/');
  url.search=new URLSearchParams({ip:'2001:db8:1234:5678:1234:5678:1234:5678',json:'',code:'x'.repeat(128),sql}).toString();
  assert.ok(url.toString().length<6000);
  const canonical=sql.replace(japanHeavyVehicleSqlExclusion(),heavyVehicleSqlExclusion()).replace(japanVehicleFamilySqlExclusion(),japanVehicleFamilyCacheSqlExclusion());
  assert.equal(ajesSourceCacheSql(sql),canonical);assert.equal(ajesSourceCacheSql(canonical),canonical);
 }
 const count=ajesSourceCacheSql(ajesQuery({aggregate:'count'}).sql),makes=ajesSourceCacheSql(ajesQuery({aggregate:'makes'}).sql);
 assert.match(ajesQueryCacheLocation(count).key,/\/counts\/overall\.json$/);
 assert.match(ajesQueryCacheLocation(makes).key,/\/directories\/makes-overall\.json$/);
 assert.notEqual(ajesQueryCacheLocation(count).key,ajesQueryCacheLocation(ajesSourceCacheSql(ajesQuery({aggregate:'count',make:'MAZDA'}).sql)).key);
});

test('wire compatibility keeps the reviewed canonical hashes and the old failed plain request maps to the same rows',()=>{
 // Hashes captured from 92b520d before the wire change. Normalize only its
 // calendar admission ceiling so this compatibility fixture survives January.
 const hash=(sql:string)=>createHash('sha256').update(sql.replace(/year<=\d{4}/,'year<=2027')).digest('hex');
 const cases:Array<[AjesQuery,string]>=[
  [{},'5bfd43524f9b1eb82c7537f4d56c4ee0820122836cae0f738ef01a55a6da5b43'],
  [{make:'MAZDA',model:'3'},'f20c6051e319f3c34d051ddfab8b5e62abfd74e4cecd98c648f0f4934ff61f5d'],
  [{fuel:'petrol',transmission:'automatic',auctionGrade:'5',powerTo:160},'7efed027be93488c9cad55478cfc5d6a16d065a455d1daa7fb87225a42f7fc28'],
  [{aggregate:'count'},'6f565b876a4bc405acc93b16e68fe803cde022014080fbd9fc1efe61eb9dbeed'],
  [{aggregate:'makes'},'24d314a1297d2b4868f9fb3769112b883ac4f55f79392afa5cf9c58f623547f3'],
  [{aggregate:'models',make:'MAZDA'},'787a56c6e9cd4abc05741028b56d07ca286f4e157c7ea5eb1f3fea3ef3b411a1'],
  [{aggregate:'colors'},'748d20463637efdda65962e0df32d7297715161cfa3f2e362e16cba00c441a36'],
  [{drive:'fwd'},'f79137d44d492c9f6bcbbe9b43236270f1320a95718dde55b08ab6d8230e716c'],
 ];
 for(const [input,expected] of cases){
  const wire=ajesQuery(input).sql,previousWire=wire.replace(japanHeavyVehicleSqlExclusion(),heavyVehicleSqlExclusion(false,false,true))
   .replace(japanVehicleFamilySqlExclusion(),japanVehicleFamilyCacheSqlExclusion());
  assert.equal(hash(ajesSourceCacheSql(wire)),expected,JSON.stringify(input));
  assert.equal(ajesSourceCacheSql(previousWire),ajesSourceCacheSql(wire));
 }
 const previousPlain=ajesQuery({}).sql.replace(japanHeavyVehicleSqlExclusion(),heavyVehicleSqlExclusion(false,false,true))
  .replace(japanVehicleFamilySqlExclusion(),japanVehicleFamilyCacheSqlExclusion());
 assert.equal(hash(previousPlain),'f2295e1764a0e8049475c136f267b7ed76e7aed28c7db686a1fc5c7b2d99fd73');
 const combined={fuel:'petrol',transmission:'automatic',auctionGrade:'5'};
 assert.equal(ajesSourceCacheSql(ajesQuery({...combined,powerTo:160}).sql),ajesSourceCacheSql(ajesQuery(combined).sql));
});

test('grouped Japan heavy-family LIKE selects the same rows as the existing expanded predicate without a REGEXP extension',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('create table cars(id integer,marka_name text,model_name text)');
  const insert=db.prepare('insert into cars values(?,?,?)');let id=0;
  const models=[...new Set(heavyVehicleFamilies.flatMap(group=>[...group.models])),'HIACE','TITAN','CARRY'];
  for(const make of [...heavyVehicleFamilies.map(group=>group.make),'MAZDA','NISSAN','FORD'])
   for(const model of models)for(const suffix of ['',' X','-X','/X','X','_X'])insert.run(id++,make,model+suffix);
  insert.run(id++,null,'ELF');insert.run(id++,'ISUZU',null);
  const selected=(predicate:string)=>db.prepare('select id from cars where '+predicate+' order by id').all();
  assert.deepEqual(selected(japanHeavyVehicleSqlExclusion()),selected(heavyVehicleSqlExclusion()));
 }finally{db.close();}
});

test('explicit drive keeps its prior compact heavy form and URI guard, while Japan-only families use LIKE',()=>{
 for(const drive of ['awd','fwd','rwd']){
  const sql=ajesQuery({drive}).sql;
  assert.ok(sql.includes(heavyVehicleSqlExclusion(false,false,true)));
  assert.ok(sql.includes(japanVehicleFamilySqlExclusion()));
  assert.ok(!sql.includes(japanVehicleFamilyCacheSqlExclusion()));
  assert.ok(new URLSearchParams({sql}).toString().length<6000);
 }
});

test('internal heavy candidates retain a distinct cache scope and identical LIST/COUNT predicates',()=>{
 const heavy=japanSourceHeavyCandidateSql();
 assert.doesNotMatch(heavy,/\bregexp\b|\blike\b/i);
 assert(heavy.includes("model_name in ('COASTER','DYNA','TOYOACE')"));
 const power={version:1 as const,power:{to:160,models:[],ids:[],ownerModels:[]}};
 const body={version:1 as const,body:{models:[{make:'TOYOTA',model:'LOCAL',years:[2023]}],ids:['manual-body'],pickupCandidates:false}};
 const cases:AjesQuery[]=[{sourceSelection:power,sourcePhase:'k',powerTo:160},{sourceSelection:power,sourcePhase:'u',powerTo:160},{sourceSelection:body}];
 const where=(sql:string)=>sql.split(' where ')[1].split(' order by ')[0];
 for(const scope of cases){
  const list=ajesQuery({...scope,sort:'totalRubDesc'}).sql,count=ajesQuery({...scope,aggregate:'count'}).sql;
  assert(list.includes(heavy));assert(count.includes(heavy));assert.equal(where(list),where(count));
  assert(!list.includes(heavyVehicleSqlExclusion(false,false,true)));
  const canonical=ajesSourceCacheSql(list),narrow=list.replace(heavy,heavyVehicleSqlExclusion(false,false,true));
  assert(canonical.includes(heavy),'weaker candidates keep their own raw membership in the cache key');
  assert.notEqual(canonical,ajesSourceCacheSql(narrow),'old narrow pages cannot satisfy the new wider source selection');
  assert.equal(ajesSourceCacheSql(canonical),canonical);
  const drive=ajesQuery({...scope,drive:'fwd'}).sql;
  assert(drive.includes(heavyVehicleSqlExclusion(false,false,true)),'the explicit-drive heavy branch remains unchanged');
  assert(!drive.includes(heavy));
 }
});

test('every displayed auction grade can be queried without relaxing SQL input validation',()=>{
 const grades=['S','6','5.5','5','4.5','4','3.5','3','2','1','0','R','RA','RB','***','**','*','A','B','C','D','E','F','0.5','1.5','2.5','6.5','7','8','9','10'];
 for(const grade of grades)assert.ok(ajesQuery({auctionGrade:grade}).sql.includes(`rate in ('${grade}')`),grade);
 assert.ok(ajesQuery({auctionGrade:'rb|***|4,5|RB'}).sql.includes("rate in ('RB','***','4.5')"));
 for(const auctionGrade of ["5') or 1=1 --",'5;drop','****','11','7.5','5|','|5',Array(21).fill('5').join('|')])assert.throws(()=>ajesQuery({auctionGrade}),/ajes_invalid_query/);
 for(const field of ['make','model','modelFamilies'] as const)assert.throws(()=>ajesQuery({[field]:'*'}),/ajes_invalid_query/);
});

test('combined source selection stays identical for list, count and directory while power remains local',()=>{
 const db=new DatabaseSync(':memory:');
 db.function('regexp',(pattern:any,value:any)=>value==null?0:Number(new RegExp(String(pattern),'i').test(String(value))));
 db.exec('create table stats(id text,year integer,auction_type integer,status text,finish integer,marka_name text,model_name text,rate text,kpp text,time text,auction_date text,pw text)');
 const insert=db.prepare('insert into stats values(?,?,?,?,?,?,?,?,?,?,?,?)');
 const rows=[['fit','TOYOTA','AQUA','5','AT','P','150'],['wrong-grade','TOYOTA','PRIUS','4','AT','P','150'],['wrong-box','TOYOTA','VITZ','5','CVT','P','150'],['wrong-fuel','MAZDA','DEMIO','5','AT','D','150'],['truck','MAZDA','TITAN','5','AT','P','150'],['unknown-fuel','HONDA','FIT','5','AT','',null],['wrong-power','TOYOTA','AQUA','5','AT','P','200']];
 for(const [id,make,model,grade,kpp,fuel,pw] of rows)insert.run(id,2021,2,'Sold',100000,make,model,grade,kpp,fuel,'2026-11-26',pw);
 const selection={auctionGrade:'5',transmission:'automatic',fuel:'petrol',powerTo:160};
 assert.deepEqual(db.prepare(ajesQuery(selection).sql).all().map(row=>row.id),['fit','unknown-fuel','wrong-power']);
 assert.equal(Object.values(db.prepare(ajesQuery({...selection,aggregate:'count'}).sql).get()!)[0],3);
 assert.equal(Object.values(db.prepare(ajesQuery({...selection,powerTo:undefined,aggregate:'count'}).sql).get()!)[0],3,'the source scalar does not claim local power admission');
 assert.deepEqual(db.prepare(ajesQuery({...selection,page:2,pageSize:1}).sql).all().map(row=>row.id),['unknown-fuel']);
 assert.deepEqual(db.prepare(ajesQuery({...selection,aggregate:'models'}).sql).all().map(row=>[row.marka_name,row.model_name]),[['HONDA','FIT'],['TOYOTA','AQUA']]);
 db.close();
});

test('current Japan policy keeps only exact historical rows as an explicitly partial fallback',async()=>{
 const input={table:'stats' as const,make:'MAZDA',model:'3'},sql=ajesSourceCacheSql(ajesQuery(input).sql);
 const previous=sql.replace(' and '+japanVehicleFamilyCacheSqlExclusion(),'');
 const saved={schemaVersion:2,items:[{id:'old-viewed',table:'stats'}],page:1,pageSize:24,received:24,observedAt:new Date(Date.now()-3600000).toISOString()};
 for(const key of [previous,previous.replace(heavyVehicleSqlExclusion(),heavyVehicleSqlExclusion(false,false,true))]){
  const read=(candidate:string)=>Promise.resolve(candidate===key?saved:null);
  const fallback=await readPreviousJapanPolicyRows(sql,read);
  assert.equal(fallback.partial,true);assert.equal(fallback.schemaVersion,0);assert.equal(fallback.observedAt,saved.observedAt);
  assert.equal(await readPreviousJapanPolicyRows(ajesSourceCacheSql(ajesQuery({...input,model:'6'}).sql),read),null);
 }
 let attempts=0,legacy=0;
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},fetcher:async()=>{attempts++;return new Response('bot fixture');},readLegacyQuery:async canonical=>{legacy++;assert.equal(canonical,sql);return readPreviousJapanPolicyRows(canonical,async key=>key===previous?saved:null);}});
 const recovered=await client.read(input,'203.0.113.1');
 assert.equal(recovered.stale,true);assert.equal(recovered.partial,true);assert.equal(recovered.observedAt,saved.observedAt);assert.equal(attempts,1);assert.equal(legacy,1);
 for(const aggregate of ['count','makes','models','colors'] as const){
  let reads=0;assert.equal(await readPreviousJapanPolicyRows(ajesSourceCacheSql(ajesQuery({...input,aggregate}).sql),async()=>{reads++;return saved;}),null);assert.equal(reads,0);
 }
});

test('the compatible wire query reuses fresh exact canonical cache without a supplier attempt',async()=>{
 const input={table:'stats' as const,make:'MAZDA',model:'3'},canonical=ajesSourceCacheSql(ajesQuery(input).sql);
 const saved={schemaVersion:2,items:[{id:'viewed-exact',table:'stats'}],page:1,pageSize:24,received:24,stale:false,observedAt:new Date(Date.now()-1000).toISOString()};
 let reads=0,attempts=0;
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{attempts++;},
  readQuery:async sql=>{reads++;assert.equal(sql,canonical);return saved;},fetcher:async()=>{throw Error('unexpected supplier request');}});
 const result=await client.read(input,'203.0.113.1');
 assert.equal(result.observedAt,saved.observedAt);assert.equal(result.stale,false);assert.deepEqual(result.items,saved.items);
 assert.equal(result.sourceReceipt.supplierAttempted,false);assert.equal(attempts,0);assert.equal(reads,1);
});

const expandedAliases=[
 {make:'AUDI',names:['A4',...Array.from({length:26},(_,i)=>'A4'+String.fromCharCode(65+i))]},
 {make:'MAZDA',names:['3','MAZDA3','MAZDA 3',...Array.from({length:19},(_,i)=>'OTHER '+i)]},
];
const counterUrl=(sql:string)=>{
 const url=new URL('http://192.0.2.123/api/');
 url.search=new URLSearchParams({ip:'2001:db8:1234:5678:1234:5678:1234:5678',json:'',code:'x'.repeat(128),sql}).toString();
 return Buffer.byteLength(url.href);
};
test('27 Audi and22 Mazda exact aliases preserve the URI budget for LIST and scalar counts with combined filters',()=>{
 for(const {make,names} of expandedAliases){
  const selection={table:'stats' as const,make,resolvedModels:{exact:names,families:[]},
   yearFrom:2015,yearTo:2024,fuel:'petrol',transmission:'automatic',auctionGrade:'5',powerTo:160};
  for(const aggregate of [undefined,'count'] as const)for(const countIdentity of aggregate?[undefined,true]:[undefined]){
   const sql=ajesQuery({...selection,aggregate,...(countIdentity?{countIdentity:true}: {})}).sql;
   assert.ok(counterUrl(sql)<6000,`${make}/${names.length}/${aggregate||'list'}: ${counterUrl(sql)} bytes`);
   for(const name of names)assert.ok(sql.includes(`'${name}'`),'no resolved source alias is discarded');
  }
  const sql=ajesQuery({table:'stats',make,resolvedModels:{exact:names,families:[]},yearFrom:2015,yearTo:2024,powerTo:160,
   aggregate:'census',censusFields:[...AJES_CENSUS_FIELDS]}).sql;
  assert.ok(counterUrl(sql)<6000,`${make}/${names.length}/basic census: ${counterUrl(sql)} bytes`);
  const scope={table:'stats' as const,make,resolvedModels:{exact:names,families:[]},yearFrom:2015,yearTo:2024,powerTo:160};
  const where=(value:string)=>value.split(' where ')[1].split(/ group by | order by /)[0];
  for(const aggregate of [undefined,'count','models'] as const)assert.equal(where(ajesQuery({...scope,aggregate}).sql),where(sql),'source scope is identical for every aggregate');
  assert.equal(sql,ajesQuery({...scope,powerTo:undefined,aggregate:'census',censusFields:[...AJES_CENSUS_FIELDS]}).sql,'power filtering retains the complete long alias selection');
  for(const name of names)assert.ok(sql.includes(`'${name}'`),'census never discards an alias to meet its budget');
  assert.match(sql,/group by 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15 order by 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15/);
  // This experimental aggregate is blocked in production. Its full technical
  // projection plus every filter still exceeds the compatibility budget with
  // this long credential/IP wrapper; no aliases are dropped to conceal that.
  const unsupported=ajesQuery({...selection,aggregate:'census',censusFields:[...AJES_CENSUS_FIELDS]}).sql;
  assert.ok(counterUrl(unsupported)>6000,`${make}/${names.length}/combined census remains unsupported`);
  assert.equal(unsupported,ajesQuery({...selection,powerTo:undefined,aggregate:'census',censusFields:[...AJES_CENSUS_FIELDS]}).sql,'this unsupported census was already over budget without PW');
 }
});

test('compact exact-model IN and unchanged family LIKE have the same SQL result as every expanded equality',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('create table stats(id integer,model_name text collate nocase)');
  const add=db.prepare('insert into stats values(?,?)');let id=0;
  for(const name of [...new Set(expandedAliases.flatMap(row=>row.names)), 'A4 AVANT','A4 AVANTX','A40','A4Z2','OTHER 190','MAZDA30','A4-AVANT','Ａ４','a4a','',null])add.run(id++,name);
  for(const {names} of expandedAliases)for(const families of [[],['A4']]){
   const sql=ajesQuery({resolvedModels:{exact:names,families}}).sql;
   const compact=sql.match(/\(model_name in \([^)]*\)(?: or model_name like '[^']*')*\)/)?.[0];
   assert.ok(compact,'one complete model selection clause');
   const expanded='('+[...names.map(name=>`model_name='${name}'`),...families.map(name=>`model_name like '${name} %'`)].join(' or ')+')';
   const selected=(where:string)=>db.prepare('select id from stats where '+where+' order by id').all();
   assert.deepEqual(selected(compact),selected(expanded));assert.ok(selected(compact).length>=names.length);
  }
  assert.match(ajesQuery({model:'A4'}).sql,/\(model_name='A4'\)/,'a singleton keeps its old SQL/cache identity');
 }finally{db.close();}
});
