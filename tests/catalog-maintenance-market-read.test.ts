import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {LocalJsonStorage} from '../apps/web/lib/data';
import {readAllOffersForMaintenance} from '../apps/web/lib/catalog/storage';

test('market refresh skips its obsolete source chunks before I/O and retains unknown sources for auditing',async()=>{
 const fixtures:any={
 'catalog/internal/manifest.json':{sources:{mobile_de_open:{chunks:['large-europe.json']},encar_direct:{chunks:['korea.json']},retired_unknown:{chunks:['unknown.json']}}},
 'catalog/japan-auction-history/manifest.json':{chunks:['japan.json']},
 'large-europe.json':[{id:'e',market:'europe'}], 'korea.json':[{id:'k',market:'korea'}], 'unknown.json':[{id:'u',market:'china'},{id:'e2',market:'europe'}], 'japan.json':[{id:'j',market:'japan'}]};
 const reads:string[]=[];
 const reader=mock.method(LocalJsonStorage.prototype,'readJsonWithMeta',async(key:string)=>{reads.push(key);return {found:true,value:fixtures[key]??{}};});
 try {
  assert.deepEqual((await readAllOffersForMaintenance({excludeMarket:'europe'})).map(o=>o.id).sort(),['j','k','u']);
  assert.ok(!reads.includes('large-europe.json'));assert.ok(reads.includes('unknown.json'));
  reads.length=0;assert.deepEqual((await readAllOffersForMaintenance({excludeMarket:'japan'})).map(o=>o.id).sort(),['e','e2','k','u']);assert.ok(!reads.includes('japan.json'));
  assert.equal((await readAllOffersForMaintenance()).length,5);
 }finally{reader.mock.restore();}
});
