import assert from 'node:assert/strict';
import test from 'node:test';
import {fillSavedJapanPowerPage} from '../apps/web/lib/catalog/ajes-saved-power-page';
import {ajesResultFilter} from '../apps/web/lib/catalog/ajes-result-filter';
import {savedAjesJapanCandidates} from '../apps/web/lib/catalog/ajes-saved-search';

const observedAt='2026-11-23T01:00:00.000Z';
const older='2026-11-22T01:00:00.000Z';
const query={table:'stats' as const,make:'Honda',powerTo:160,pageSize:2};
const matches=ajesResultFilter(query).matchesPower;
const lot=(id:string,powerHp?:number)=>({id,table:'stats',make:'Honda',model:'Fit',year:2021,status:'sold',finalPriceJpy:1500000,powerHp,sourcePower:100,auctionDate:'2026-11-20'});
const saved=(row:ReturnType<typeof lot>,date=observedAt)=>({observedAt:date,items:[row]});
test('filter the eligible saved auction rows before filling a partial page',async()=>{
 const records=[
  saved(lot('1')),saved(lot('2',170)),saved(lot('3',159),older),saved(lot('4',160)),
  saved({...lot('5',150),make:'Toyota'}),saved(lot('6',140),'2026-11-01T00:00:00.000Z'),
 ];
 const scope=savedAjesJapanCandidates(query,Object.fromEntries(records.map(r=>[r.items[0].id,r])),Date.parse(observedAt));
 assert.deepEqual(scope?.map(r=>r.items[0].id),['1','2','3','4']);
 const ids:string[]=[];
 const page=await fillSavedJapanPowerPage({items:[{id:'ajes-stats-2',sourceOfferId:'2',powerHp:170}],
  pageSize:2,observedAt,matches,readCandidates:async()=>scope,enrich:async(row:ReturnType<typeof lot>)=>{
   ids.push(row.id);return {id:'ajes-stats-'+row.id,sourceOfferId:row.id,powerHp:row.powerHp};
  }});
 assert.deepEqual(page.items.map(r=>r.sourceOfferId),['3','4']);
 assert.equal(page.observedAt,older);
 assert(!ids.includes('2'));
});
test('an already filled guest page does not reopen the cache',async()=>{
 const item={id:'one',sourceOfferId:'1',powerHp:150};
 const page=await fillSavedJapanPowerPage({items:[item],pageSize:1,observedAt,matches,
  readCandidates:async()=>{throw Error('unexpected cache read');},enrich:async()=>item});
 assert.deepEqual(page.items,[item]);
});
