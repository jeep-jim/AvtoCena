import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  catalogConfirmedWithdrawalIndex, catalogOfferWithdrawnByReport,
  catalogRetentionDecision, catalogSourceRefreshStates,
} from '../apps/web/lib/catalog/source-retention';
import {catalogOfferRetentionExpired} from '../apps/web/lib/catalog/refresh-policy';
import {catalogPublicCountGuard} from '../scripts/lib/catalog-public-count-guard.mjs';

const DAY = 86_400_000;
const now = Date.UTC(2026, 10, 23, 13);
const publisher = fs.readFileSync(new URL('../scripts/catalog-publish-market.mjs', import.meta.url), 'utf8');
// Run the real publisher's retention and safety-baseline stages with in-memory
// reads. Do not start the publisher or contact storage/providers from this test.
const retentionStart = publisher.indexOf('const sourceRefreshStates =');
const retentionEnd = publisher.indexOf('// Do not retain the superseded raw payloads');
const baselineStart = publisher.indexOf('const previousPublicCount =');
const baselineEnd = publisher.indexOf('const replaceInternalSourceIds =');
assert.ok(retentionStart >= 0 && retentionEnd > retentionStart && baselineStart > retentionEnd && baselineEnd > baselineStart);
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
const runStages = new AsyncFunction('context', `
  const {generation,market,catalogSourceRefreshStates,catalogConfirmedWithdrawalIndex,
    readMarketOffers,technicalRepairGuard,snapshotCatalogRows,sellerInventory,
    readMarketMaintenanceOffers,logPublicationMemory,paidEncarReport,
    catalogOfferWithdrawnByReport,catalogRetentionDecision,retentionMs,
    outageGraceMultiplier,countSources,catalogOfferRetentionExpired,sourceInventoryInScope}=context;
  ${publisher.slice(retentionStart, retentionEnd)}
  ${publisher.slice(baselineStart, baselineEnd)}
  return {retained:currentRetainedRows,previousSourceCounts,withdrawnSourceCounts};
`);

function row(index: number, ageDays = 1, sourceId = 'autoscout_europe_open') {
  return {id:`europe-${index}`, sourceOfferId:`source-${index}`, sourceId, market:'europe',
    status:'active', updatedAt:new Date(now - ageDays * DAY).toISOString()};
}

async function exercise(rows: ReturnType<typeof row>[], confirmedWithdrawals: unknown[] = []) {
  const report = {
    durableIntakeArchive:{market:'europe'}, completed:true,
    qualityStatus:'configured_routes_finished', partialSources:[], confirmedWithdrawals,
    sources:[{sourceId:'autoscout_europe_open', mode:'live', pages:201,
      freshSaved:10, observations:10, sourceReportedCount:0, stopReason:'source_finished',
      health:{message:'AutoScout24 public result window ended at page 201'}}],
  };
  return runStages({
    market:'europe', generation:{payloads:[{report}], offers:rows.slice(0,10)},
    catalogSourceRefreshStates,catalogConfirmedWithdrawalIndex,catalogOfferWithdrawnByReport,
    catalogRetentionDecision:(args: any)=>catalogRetentionDecision({...args,now}),
    catalogOfferRetentionExpired:(offer: any)=>catalogOfferRetentionExpired(offer,now),
    readMarketOffers:async()=>structuredClone(rows), technicalRepairGuard:undefined,
    snapshotCatalogRows:()=>({}), sellerInventory:false,
    readMarketMaintenanceOffers:async()=>{throw Error('unexpected maintenance read');},
    logPublicationMemory:()=>{}, paidEncarReport:undefined,
    retentionMs:14*DAY,outageGraceMultiplier:1,sourceInventoryInScope:()=>true,
    countSources:(offers: any[])=>offers.reduce((counts,offer)=>{
      counts[offer.sourceId]=(counts[offer.sourceId]||0)+1;return counts;
    },{}),
  });
}

test('a completed AutoScout result window retains current cars outside that window and cannot explain a collapse',async()=>{
  const rows=Array.from({length:100},(_,index)=>row(index));
  const result=await exercise(rows);
  assert.deepEqual(result.retained.map((offer: any)=>offer.id),rows.map(offer=>offer.id));
  assert.deepEqual(result.withdrawnSourceCounts,{});
  const guard=catalogPublicCountGuard(result.previousSourceCounts,{autoscout_europe_open:10},result.withdrawnSourceCounts);
  assert.equal(guard.ok,false);
  assert.equal(guard.minimumTotal,90);
});

test('explicit same-source withdrawals remain valid exclusions',async()=>{
  const rows=Array.from({length:100},(_,index)=>row(index));
  const withdrawals=rows.slice(10).map(offer=>({...offer,status:'removed',observedAt:new Date(now).toISOString()}));
  const result=await exercise(rows,withdrawals);
  assert.equal(result.retained.length,10);
  assert.deepEqual(result.withdrawnSourceCounts,{autoscout_europe_open:90});
  assert.equal(catalogPublicCountGuard(result.previousSourceCounts,{autoscout_europe_open:10},result.withdrawnSourceCounts).ok,true);
});

test('the existing dated retention policy still expires old unverified rows',async()=>{
  const rows=Array.from({length:100},(_,index)=>row(index,index<10?1:15));
  const result=await exercise(rows);
  assert.equal(result.retained.length,10);
  assert.deepEqual(result.withdrawnSourceCounts,{autoscout_europe_open:90});
});

test('the retired mobile.de source is not reintroduced by window retention',async()=>{
  const result=await exercise([row(0),row(1,1,'mobile_de_open')]);
  assert.deepEqual(result.retained.map((offer: any)=>offer.id),['europe-0']);
  assert.deepEqual(result.withdrawnSourceCounts,{mobile_de_open:1});
});
