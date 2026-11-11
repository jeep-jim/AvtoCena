import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogSearchProjectionMatches,stableOfferId} from '../apps/web/lib/catalog/storage';
test('make-only membership matches full normalization across markets and conflicting mechanical inputs',()=>{
 const rows:any[]=[];
 for(const market of ['china','japan','korea','uae','europe','georgia'])for(const make of ['Volkswagen','VW','Toyota','Honda','BMW','Audi','Kia'])for(const powerHp of [undefined,150,999])rows.push({id:'test',market,make,model:make==='Toyota'?'Yaris':'Car',year:2025,powerHp,fuel:'electric',powertrainKind:'combustion',engineCc:1498});
 rows.push({id:'48361d3deeccac1d8612ae42',market:'china',make:'Volkswagen'});
 rows.push({id:stableOfferId('kcar_korea_open','EC61409859'),market:'korea',make:'Volkswagen',sourceId:'kcar_korea_open',sourceOfferId:'EC61409859',updatedAt:'2026-09-13T00:00:00Z'});
 for(const row of rows)for(const make of ['Volkswagen','VW','Toyota','Audi,BMW','Honda|Kia']){
  const before=structuredClone(row);
  assert.equal(catalogSearchProjectionMatches(row,{make}),catalogSearchProjectionMatches(row,{make,page:1}),JSON.stringify([row.market,row.make,make]));
  assert.deepEqual(row,before);
 }
});
test('make-only filtering does not inspect unrelated power or price fields',()=>{
 const row:any={id:'test',market:'china',make:'Volkswagen',model:'Tiguan'};
 for(const field of ['powerHp','engineCc','calculationSnapshot'])Object.defineProperty(row,field,{get(){throw Error('unrelated mechanical read');}});
 assert.equal(catalogSearchProjectionMatches(row,{make:'Volkswagen'}),true);
 assert.equal(catalogSearchProjectionMatches(row,{make:'BMW'}),false);
});
