import test from 'node:test';
import assert from 'node:assert/strict';
import {knownHeavyVehicleFamily,heavyVehicleSqlExclusion} from '../apps/web/lib/catalog/heavy-vehicle-families';
import {readFilteredAjesPage} from '../apps/web/lib/catalog/ajes-filtered-page';
import {resolvePriceTrend,withLiveRate} from '../apps/web/components/catalog/PriceTrend';
test('Toyota trucks excluded while passenger vans and pickups remain',()=>{
 for(const model of ['DYNA','DYNA 4WD','TOYOACE'])assert.equal(knownHeavyVehicleFamily('TOYOTA',model),true);
 for(const model of ['HILUX','HIACE','SIENTA'])assert.equal(knownHeavyVehicleFamily('TOYOTA',model),false);
 assert.match(heavyVehicleSqlExclusion(),/model_name='DYNA'/);
});
test('Japanese filtered source page fills 24 slots and resumes without repeating borrowed cards',async()=>{
 const pages=[Array.from({length:20},(_,i)=>`a${i}`),Array.from({length:24},(_,i)=>`b${i}`),Array.from({length:24},(_,i)=>`c${i}`)];
 const read=async(p:number)=>({items:pages[p-1]||[],received:24});
 const first=await readFilteredAjesPage({page:1,pageSize:24,read});assert.equal(first.items.length,24);assert.equal(first.nextCursor,'2.4');
 const next=await readFilteredAjesPage({page:2,pageSize:24,after:first.nextCursor,read});assert.equal(next.items.length,24);assert.equal(first.items.some(x=>next.items.includes(x)),false);
});
test('calculated Japanese price follows yen direction without changing total',()=>{
 const offer={totalRub:754450,sourcePrice:500000,sourceCurrency:'JPY'};
 for(const [delta,direction] of [[-.001,'down'],[.001,'up']] as const){const result=withLiveRate(offer,{currency:'JPY',effectiveRate:.55,previousEffectiveRate:.55-delta,rateDelta:delta});assert.equal(resolvePriceTrend(result)?.direction,direction);assert.equal(result.totalRub,754450);}
});
