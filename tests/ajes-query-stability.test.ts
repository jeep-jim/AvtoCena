import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ajesQuery,ajesSourceCacheSql} from '../apps/web/lib/catalog/ajes-query';
import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';
import {heavyVehicleSqlExclusion} from '../apps/web/lib/catalog/heavy-vehicle-families';
import {japanVehicleFamilySqlExclusion} from '../apps/web/lib/catalog/japan-vehicle-policy';
import {ajesQueryCacheLocation,readPreviousJapanPolicyRows} from '../apps/web/lib/catalog/ajes-query-cache';

test('plain, selected-model and combined filters use compact SQL for every source query kind',()=>{
 for(const table of ['stats','main'] as const)for(const aggregate of [undefined,'count','makes','models','colors'] as const)
 for(const filters of [{},{make:'MAZDA',model:'3'},{auctionGrade:'5',transmission:'automatic',fuel:'petrol',powerTo:160}]){
  const sql=ajesQuery({table,aggregate,...filters}).sql;
  assert.ok(sql.includes(heavyVehicleSqlExclusion(false,false,true)));
  assert.ok(new URLSearchParams({ip:'2001:db8:1234:5678:1234:5678:1234:5678',json:'',code:'x'.repeat(128),sql}).toString().length<6000);
  assert.equal(ajesSourceCacheSql(sql),sql.replace(heavyVehicleSqlExclusion(false,false,true),heavyVehicleSqlExclusion()));
 }
 const count=ajesSourceCacheSql(ajesQuery({aggregate:'count'}).sql),makes=ajesSourceCacheSql(ajesQuery({aggregate:'makes'}).sql);
 assert.match(ajesQueryCacheLocation(count).key,/\/counts\/overall\.json$/);
 assert.match(ajesQueryCacheLocation(makes).key,/\/directories\/makes-overall\.json$/);
 assert.notEqual(ajesQueryCacheLocation(count).key,ajesQueryCacheLocation(ajesSourceCacheSql(ajesQuery({aggregate:'count',make:'MAZDA'}).sql)).key);
});

test('every displayed auction grade can be queried without relaxing SQL input validation',()=>{
 const grades=['S','6','5.5','5','4.5','4','3.5','3','2','1','0','R','RA','RB','***','**','*','A','B','C','D','E','F','0.5','1.5','2.5','6.5','7','8','9','10'];
 for(const grade of grades)assert.ok(ajesQuery({auctionGrade:grade}).sql.includes(`rate in ('${grade}')`),grade);
 assert.ok(ajesQuery({auctionGrade:'rb|***|4,5|RB'}).sql.includes("rate in ('RB','***','4.5')"));
 for(const auctionGrade of ["5') or 1=1 --",'5;drop','****','11','7.5','5|','|5',Array(21).fill('5').join('|')])assert.throws(()=>ajesQuery({auctionGrade}),/ajes_invalid_query/);
 for(const field of ['make','model','modelFamilies'] as const)assert.throws(()=>ajesQuery({[field]:'*'}),/ajes_invalid_query/);
});

test('combined grade, gearbox and fuel selection is identical for list, count and model directory',()=>{
 const db=new DatabaseSync(':memory:');
 db.function('regexp',(pattern,value)=>value===null?null:Number(new RegExp(String(pattern),'i').test(String(value))));
 db.exec('create table stats(id text,year integer,auction_type integer,status text,finish integer,marka_name text,model_name text,rate text,kpp text,time text,auction_date text)');
 const insert=db.prepare('insert into stats values(?,?,?,?,?,?,?,?,?,?,?)');
 const rows=[['fit','TOYOTA','AQUA','5','AT','P'],['wrong-grade','TOYOTA','PRIUS','4','AT','P'],['wrong-box','TOYOTA','VITZ','5','CVT','P'],['wrong-fuel','MAZDA','DEMIO','5','AT','D'],['truck','MAZDA','TITAN','5','AT','P'],['unknown-fuel','HONDA','FIT','5','AT','']];
 for(const [id,make,model,grade,kpp,fuel] of rows)insert.run(id,2021,2,'Sold',100000,make,model,grade,kpp,fuel,'2026-11-26');
 const selection={auctionGrade:'5',transmission:'automatic',fuel:'petrol',powerTo:160};
 assert.deepEqual(db.prepare(ajesQuery(selection).sql).all().map(row=>row.id),['fit','unknown-fuel']);
 assert.equal(Object.values(db.prepare(ajesQuery({...selection,aggregate:'count'}).sql).get()!)[0],2);
 assert.deepEqual(db.prepare(ajesQuery({...selection,aggregate:'models'}).sql).all().map(row=>[row.marka_name,row.model_name]),[['HONDA','FIT'],['TOYOTA','AQUA']]);
 db.close();
});

test('current Japan policy keeps only exact historical rows as an explicitly partial fallback',async()=>{
 const input={table:'stats' as const,make:'MAZDA',model:'3'},sql=ajesSourceCacheSql(ajesQuery(input).sql);
 const previous=sql.replace(' and '+japanVehicleFamilySqlExclusion(),'');
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
