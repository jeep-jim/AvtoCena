import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessMarketScheduleAdmission as assess, CATALOG_MARKET_SCHEDULE_V1 as policy} from '../scripts/lib/catalog-market-schedule-admission.mjs';

const D = (date, hour = 17) => `${date}T${hour}:00:00.000Z`;
const baselineOf = (market, coveredWakeAt) => ({market, revision: 5, receiptSha256: 'a'.repeat(64), coveredWakeAt, acceptedAt: coveredWakeAt});
const inputFor = (market, baseline, candidate, hour = 17) => ({
  market, scheduledWakeAt: D(candidate, hour), now: D(candidate, hour), held: false, ownerEnabled: true,
  baseline: baselineOf(market,D(baseline,hour)), accepted: baselineOf(market,D(baseline,hour)), claim: null,
});
const judge = (input) => assess(input).decision;
const isStored = (input) => assert.equal(judge(input), 'eligible_stored_source_claim');
const reason = (input, why) => assert.deepEqual(assess(input), {decision:'hold',reason:why,newCollectionAuthorized:false});
const withOldClaim = (i, coveredWakeAt, state='open') => ({market:i.market, coveredWakeAt, state, baselineReceiptSha256:i.baseline.receiptSha256,
  expectedAcceptedRevision:i.accepted.revision, expectedAcceptedSha256:i.accepted.receiptSha256});

test('cadence is frozen and exact; Europe is only a delegation', () => {
  assert.equal(policy.china.days, 1);
  assert.equal(policy.korea.days, 2);
  assert.equal(policy.uae.days, 2);
  assert.equal(policy.georgia.days, 2);
  assert.equal(policy.green.days, 3);
  assert.equal(policy.japan.lane, 'online_only');
  assert.equal(judge({market:'europe'}), 'delegate');
  assert.throws(() => { policy.korea.days=3; },TypeError);
  for(const market of ['__proto__','toString','us','kyrgyzstan',42,null]) reason({market},'unknown_market');
});

test('one-day China anchored to accepted receipt and exact existing UTC hour', () => {
  reason(inputFor('china','2026-11-20','2026-11-20',14),'slot_already_accepted');
  isStored(inputFor('china','2026-11-20','2026-11-21',14));
  isStored(inputFor('china','2026-11-20','2026-12-01',14)); // no catch-up burst
  reason(inputFor('china','2026-11-20','2026-11-21',17),'wake_invalid_or_expired');
});

test('all two-day stored lanes retain phase across month, year and leap day', () => {
  for(const market of ['korea','uae','georgia']){
    reason(inputFor(market,'2026-12-30','2026-12-31'),'outside_cadence_slot');
    isStored(inputFor(market,'2026-12-30','2027-01-01'));
    reason(inputFor(market,'2026-12-30','2027-01-02'),'outside_cadence_slot');
    isStored(inputFor(market,'2026-12-30','2027-01-03'));
    isStored(inputFor(market,'2028-02-28','2028-03-01'));
    reason(inputFor(market,'2028-02-28','2028-03-02'),'outside_cadence_slot');
  }
});

test('Green Corner keeps a distinct three-day clock, not Japan scope', () => {
  reason(inputFor('green','2026-11-29','2026-12-01'),'outside_cadence_slot');
  isStored(inputFor('green','2026-11-29','2026-12-02'));
  isStored(inputFor('green','2026-11-29','2026-12-05'));
  reason(inputFor('green','2026-11-29','2026-12-06'),'outside_cadence_slot');
});

test('Japan exactly two UTC+7 calendar openings in every month, online only', () => {
  const baseline='2026-12-15'; // local 16 December
  const months=new Map();
  for(let n=Date.UTC(2026,11,31,17);n<Date.UTC(2028,2,31,17);n+=86_400_000){
    const date=new Date(n).toISOString().slice(0,10);
    const result=assess(inputFor('japan',baseline,date));
    const local=new Date(n+7*3_600_000).toISOString().slice(0,10);
    if(result.decision!=='eligible_online_only_claim') continue;
    assert.equal(result.allowsLocalFullDownload,false);
    assert.equal(result.newCollectionAuthorized,false);
    const month=local.slice(0,7);
    months.set(month,[...(months.get(month)||[]),local.slice(8)]);
  }
  assert.equal(months.size,15);
  for(const days of months.values()) assert.deepEqual(days,['01','16']);
  reason(inputFor('japan','2026-12-16','2027-01-15'),'accepted_evidence_invalid');
  reason(inputFor('japan','2026-12-15','2027-02-27'),'outside_cadence_slot');
});

test('closed daily slot never becomes a fresh late retry; 24h admission boundary', () => {
  const i=inputFor('korea','2026-11-29','2026-12-01');
  isStored({...i,now:'2026-12-02T16:59:59.999Z'});
  reason({...i,now:'2026-12-02T17:00:00.000Z'},'wake_invalid_or_expired');
  reason({...i,now:'2026-12-01T16:59:59.999Z'},'wake_invalid_or_expired');
  reason({...i,scheduledWakeAt:'2026-11-31T17:00:00.000Z'},'wake_invalid_or_expired');
  reason({...i,claim:withOldClaim(i,i.scheduledWakeAt,'closed')},'slot_already_claimed');
});

test('held, owner off, missing or backwards/misbound accepted receipts fail closed', () => {
  const i=inputFor('korea','2026-11-29','2026-12-01');
  reason({...i,held:true},'not_armed_or_owner_off');
  reason({...i,held:undefined},'not_armed_or_owner_off');
  reason({...i,ownerEnabled:false},'not_armed_or_owner_off');
  for(const accepted of [null,{...i.accepted,market:'china'},{...i.accepted,revision:4},
    {...i.accepted,receiptSha256:'f'.repeat(64)},
    {...i.accepted,revision:6},{...i.accepted,acceptedAt:'2026-12-02T17:00:00.000Z'}])
    reason({...i,accepted},'accepted_evidence_invalid');
});

test('accepted receipt is not conflated with baseline; late publication does not rephase', () => {
  const i=inputFor('uae','2026-11-29','2026-12-05');
  const r=assess(i);
  const accepted={...i.accepted,revision:6,receiptSha256:'b'.repeat(64),
    coveredWakeAt:D('2026-12-01'),acceptedAt:'2026-12-02T09:13:00.000Z'};
  const later=assess({...i,accepted});
  assert.equal(later.slotKey,r.slotKey);
  assert.deepEqual(later.expectedActive,{revision:6,receiptSha256:'b'.repeat(64)});
  reason({...i,accepted,scheduledWakeAt:D('2026-12-01')},'wake_invalid_or_expired');
  reason({...i,accepted:{...accepted,coveredWakeAt:D('2026-12-05'),acceptedAt:D('2026-12-05')}},'slot_already_accepted');
});

test('one open claim blocks same lane only, including prior slot; none implicitly authorized', () => {
  const i=inputFor('georgia','2026-12-01','2026-12-05');
  const prior=withOldClaim(i,D('2026-12-03'));
  reason({...i,claim:prior},'existing_claim_reconcile_only');
  reason({...i,claim:withOldClaim(i,i.scheduledWakeAt)},'existing_claim_reconcile_only');
  reason({...i,claim:{...prior,market:'uae'}},'claim_invalid');
  reason({...i,claim:{...prior,expectedAcceptedSha256:'f'.repeat(64)}},'claim_invalid');
  reason({...i,claim:undefined},'claim_status_not_verified');
  isStored({...i,claim:{...prior,state:'closed'}});
  const other=assess(inputFor('uae','2026-12-01','2026-12-05'));
  assert.equal(other.decision,'eligible_stored_source_claim');
  assert.equal(other.newCollectionAuthorized,false);
  assert.notEqual(assess(i).slotKey,other.slotKey);
});
