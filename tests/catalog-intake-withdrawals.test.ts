import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectSourcePage, intakeState, intakeReportEvidence } from '../scripts/lib/catalog-source-intake.mjs';
import { convertMarketOnDisk } from '../scripts/lib/catalog-disk-conversion.mjs';
import { catalogConfirmedWithdrawalIndex, catalogOfferWithdrawnByReport } from '../apps/web/lib/catalog/source-retention';
const base = {id:'car', sourceId:'dubicars_uae_exact', sourceOfferId:'123', market:'uae', year:2022, status:'active', updatedAt:'2026-09-20T00:00:00Z'};
async function collect(items:any[], detail:Function = async()=>[], role='inventory') {
 const source={sourceId:base.sourceId, fetchPage:async()=>({items}), normalizeOffer:(row:any)=>row, fetchImages:detail};
 const state=intakeState(source,{sourceId:base.sourceId,role});
 const rows:any[]=[];
 await collectSourcePage(state,{market:items[0]?.market || 'uae',deadline:Date.now()+10000,maxRows:100,maxPages:5,minYear:2020,
 snapshot:(offer:any,stage:string)=>({offer:structuredClone(offer),stage}),writeObservation:async(row:any)=>{rows.push(row)},checkpoint:async()=>{}});
 return {state,rows,report:intakeReportEvidence([state])};
}
test('explicit withdrawals survive conversion and remove exactly the previous source identity',async()=>{
 const {rows,report}=await collect([{...base,status:'sold',year:2010}]);
 assert.equal(rows.length,0);assert.equal(report.confirmedWithdrawals.length,1);
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'intake-withdrawal-'));
 try {
  await convertMarketOnDisk({market:'uae',directory,files:[],out:directory,report});
  const payload=JSON.parse(await fs.readFile(path.join(directory,'catalog-rebuild-uae-0001.json'),'utf8'));
  const index=catalogConfirmedWithdrawalIndex([payload],'uae');
  assert.equal(catalogOfferWithdrawnByReport(base as any,index),true);
  assert.equal(catalogOfferWithdrawnByReport({...base,sourceOfferId:'another'} as any,index),false);
  assert.equal(catalogOfferWithdrawnByReport({...base,updatedAt:'2099-01-01T00:00:00Z'} as any,index),false);
 } finally {await fs.rm(directory,{recursive:true,force:true});}
});
test('detail-confirmed removal reaches the report',async()=>{
 const result=await collect([{...base}],async(offer:any)=>{offer.status='removed';return []});
 assert.equal(result.report.confirmedWithdrawals[0].status,'removed');
});
test('unknown status, missing identity, access failure and auction history never become sale evidence',async()=>{
 for(const item of [{...base,status:'stale'},{...base,status:'inactive'},{...base,status:'sold',sourceOfferId:''}]) {
  assert.deepEqual((await collect([item])).report.confirmedWithdrawals,[]);
 }
 const blocked=await collect([{...base}],async()=>{throw Error('http_403')});
 assert.deepEqual(blocked.report.confirmedWithdrawals,[]);assert.equal(blocked.state.stopReason,'blocked_detail');
 assert.deepEqual((await collect([{...base,status:'sold',market:'japan'}],undefined,'auction_history')).report.confirmedWithdrawals,[]);
});
