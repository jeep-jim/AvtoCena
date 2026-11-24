import test from 'node:test';
import assert from 'node:assert/strict';
import {MARKET_POLICIES,MARKET_REFRESH_ANCHOR,marketPolicy,marketRefreshDue} from '../scripts/catalog-next/market-policy.mjs';

test('each market has its own exact approved cadence, without month boundary reset',()=>{
  const intervals={japan:7,china:1,korea:2,europe:3,uae:2,georgia:2,green:3};
  const anchor=Date.parse(MARKET_REFRESH_ANCHOR);
  for(const [market,interval] of Object.entries(intervals)) {
    assert.equal(marketPolicy(market).intervalDays,interval);
    for(let day=0;day<100;day++)assert.equal(marketRefreshDue(new Date(anchor+day*86400000),market),day%interval===0);
  }
});

test('the purchased source mapping and explicit year bounds cannot inherit a neighbouring market',()=>{
  assert.deepEqual(['china','korea','uae'].map(market=>marketPolicy(market).provider),['auto_api','auto_api','auto_api']);
  assert.equal(marketPolicy('japan').provider,'aj_system');
  assert.equal(marketPolicy('europe').source,'mobile_de');
  assert.equal(marketPolicy('china').minimumYear,2014);assert.equal(marketPolicy('korea').minimumYear,2014);
  assert.equal(marketPolicy('japan').minimumYear,2008);assert.equal(marketPolicy('europe').minimumYear,null);
  assert.throws(()=>marketPolicy('unknown'),/unknown/);
  assert.throws(()=>{MARKET_POLICIES.china.intervalDays=2;},TypeError);
});

test('invalid clocks do not silently start a source update',()=>{
  assert.equal(marketRefreshDue(new Date('invalid'),'china'),false);
  assert.equal(marketRefreshDue(new Date(Date.parse(MARKET_REFRESH_ANCHOR)-1),'china'),false);
});
