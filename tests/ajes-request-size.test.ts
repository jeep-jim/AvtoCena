import test from 'node:test';
import assert from 'node:assert/strict';
import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';
import {ajesQuery} from '../apps/web/lib/catalog/ajes-query';
import {heavyVehicleFamilies,heavyVehicleSqlExclusion,knownHeavyVehicleFamily} from '../apps/web/lib/catalog/heavy-vehicle-families';

test('all supplier page and directory requests use compact admission without changing cache identity or visitor',async()=>{
 for(const table of ['stats','main','korea','china'] as const)for(const aggregate of [undefined,'count','makes','models'] as const){
  const input={table,aggregate,pageSize:24};const query=ajesQuery(input);let wire='';let cached='';
  const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},readQuery:async sql=>{cached=sql;return null;},fetcher:async url=>{
   const parsed=new URL(String(url));wire=parsed.searchParams.get('sql')!;
   assert.equal(parsed.searchParams.get('ip'),'8.8.8.8');
   assert.ok(parsed.href.length<4000,`${table}/${aggregate}: ${parsed.href.length}`);
   return Response.json(aggregate==='count'?[{total:1}]:aggregate==='makes'?[{MARKA_NAME:'TOYOTA',total:1}]:aggregate==='models'?[{MARKA_NAME:'TOYOTA',MODEL_NAME:'PRIUS',total:1}]:[]);
  }});
  await client.read(input,'8.8.8.8');
  assert.equal(cached,query.sql);
  assert.equal(wire,query.sql.replace(heavyVehicleSqlExclusion(),heavyVehicleSqlExclusion(false,false,true)));
  assert.ok(wire.length<query.sql.length/2);
 }
});

test('compact family boundaries preserve every truck alias and passenger near-match',()=>{
 const sql=heavyVehicleSqlExclusion(false,false,true);
 const groups=[...sql.matchAll(/marka_name in \(([^)]+)\) and model_name regexp '([^']+)'/g)].map(m=>({makes:m[1].split(',').map(v=>v.slice(1,-1)),pattern:new RegExp(m[2])}));
 assert.ok(groups.length>0);
 for(const group of heavyVehicleFamilies)for(const model of group.models)for(const suffix of ['',' Refrigerator','-Dump','/Truck','X','ER']){
  const actual=groups.some(g=>g.makes.includes(group.make)&&g.pattern.test(model+suffix));
  assert.equal(actual,knownHeavyVehicleFamily(group.make,model+suffix),group.make+' '+model+suffix);
 }
 for(const [make,model] of [['NISSAN','NOTE'],['MITSUBISHI','OUTLANDER'],['TOYOTA','HIACE'],['FORD','RANGER'],['ISUZU','GALAXY']])assert.equal(groups.some(g=>g.makes.includes(make)&&g.pattern.test(model)),false);
});
