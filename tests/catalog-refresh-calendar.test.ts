import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain JS used by GitHub's planning job
import { catalogRefreshDue, CATALOG_REFRESH_ANCHOR } from '../scripts/lib/catalog-refresh-schedule.mjs';

test('one collection every 72 hours across month/year/leap-day boundaries', () => {
  const start = Date.parse(CATALOG_REFRESH_ANCHOR);
  let last = start;
  for (let day = 0; day < 1100; day++) {
    const instant = start + day * 86400000;
    if (catalogRefreshDue(new Date(instant))) {
      if (day) assert.equal(instant - last, 72 * 3600000);
      last = instant;
    } else assert.notEqual(day % 3, 0);
  }
  assert.equal(catalogRefreshDue(new Date('2026-09-29T18:00:00Z')), true);
  assert.equal(catalogRefreshDue(new Date('2026-10-02T18:00:00Z')), true);
  assert.equal(catalogRefreshDue(new Date(start - 1)), false);
  assert.equal(catalogRefreshDue(new Date(start + 13 * 3600000)), true); // delayed cron
  assert.equal(catalogRefreshDue(new Date(start + 24 * 3600000)), false);
  assert.equal(catalogRefreshDue(new Date('invalid')), false);
});

test('midnight UTC+7 wake-up and delayed starts select the same three-day cycle',()=>{
 for(let day=0;day<30;day++){
  const planned=Date.parse('2026-11-01T17:00:00Z')+day*86400000;
  for(const delayHours of [0,1,4,13,23])assert.equal(catalogRefreshDue(new Date(planned+delayHours*3600000)),day%3===0);
 }
});

test('independent daily, two-day, three-day and weekly schedules cross calendar boundaries', () => {
 const anchor = Date.parse(CATALOG_REFRESH_ANCHOR);
 for(let day=0;day<400;day++){
  const now = new Date(anchor + day*86400000);
  for(const [market, days] of Object.entries({china:1, korea:2, uae:2, georgia:2, green:3, europe:3, japan:7}))
   assert.equal(catalogRefreshDue(now, market), day % days === 0, market);
  assert.equal(catalogRefreshDue(now, 'unknown'), false);
 }
});
