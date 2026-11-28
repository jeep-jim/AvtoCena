import test from 'node:test';
import assert from 'node:assert/strict';
import {createAjesSourceCountSummary} from '../apps/web/lib/catalog/ajes-source-count';
import {ajesCountText,ajesCountLabel,ajesCountExplanation,ajesVisibleCount,exactAjesCount,latestAjesCountSummary} from '../apps/web/lib/catalog/ajes-count-display';

const observedAt='2026-11-28T08:00:00Z';
const binding={requestedQueryHash:'a'.repeat(64),sourceQueryHash:'b'.repeat(64),evidenceEpoch:'c'.repeat(64),sourceScopeComplete:true,directoryComplete:true};
test('a positive scalar count is visible as the auction database size, never a page or admitted total',t=>{
 t.mock.method(Date,'now',()=>Date.parse('2026-11-28T08:15:00Z'));
 const source=createAjesSourceCountSummary({total:147867,stale:false,observedAt},binding);
 assert.equal(ajesCountText(source),'147\u00a0867 в базе аукционов');
 assert.equal(exactAjesCount(source),undefined);
 assert.equal(exactAjesCount({...source,upperBound:false}),undefined,'a source proof never becomes admitted by changing its flag');
 assert.deepEqual(ajesVisibleCount(source,24),{text:'147\u00a0867 в базе аукционов',total:undefined,loadedCount:24,status:'bounded'});
 assert.equal(ajesCountLabel(source,24),'В базе аукционов: 147\u00a0867');
 assert.equal(ajesCountLabel(source,48),'В базе аукционов: 147\u00a0867','append does not change the source aggregate');
 assert.equal(ajesCountExplanation(source,48),undefined);
 for(const filters of ['power','budget','body','hasPrice'])assert.equal(ajesVisibleCount(source,24).total,undefined,filters+' cannot turn candidate count into exact inventory');
});
test('a source scope that can lose local matches is not labelled a global upper bound',t=>{
 t.mock.method(Date,'now',()=>Date.parse('2026-11-28T08:15:00Z'));
 for(const total of [0,46]){
  const source=createAjesSourceCountSummary({total,stale:false,observedAt},{...binding,sourceScopeComplete:false});
  const shown=total?24:0;
  assert.equal(ajesCountLabel(source,shown),`В базе аукционов: ${total}`);
  assert.equal(ajesVisibleCount(source,shown).status,'source');
  assert.equal(exactAjesCount(source),undefined);
  assert.equal(ajesCountExplanation(source,shown),undefined);
 }
});
test('failed or contradictory counts retain explicitly labelled loaded matches',t=>{
 t.mock.method(Date,'now',()=>Date.parse('2026-11-28T08:15:00Z'));
 for(const summary of [null,{total:0,stale:false,observedAt,upperBound:true},createAjesSourceCountSummary({total:10,stale:false,observedAt},binding)]){
  assert.equal(ajesCountLabel(summary,24),'Количество уточняется');
  assert.equal(ajesVisibleCount(summary,24).total,undefined);
 }
 assert.equal(ajesCountLabel(null,0),'Количество уточняется');
 assert.equal(ajesCountLabel(null),'Количество уточняется');
 const exact={total:0,stale:false,observedAt,upperBound:false};
 assert.equal(ajesCountLabel(exact,0),'Найдено 0');
});
test('count cache retains dates, expires to a historical label and never renews on failure',t=>{
 let now=Date.parse('2026-11-28T08:15:00Z');t.mock.method(Date,'now',()=>now);
 const source=createAjesSourceCountSummary({total:46,stale:false,observedAt},binding);
 assert.equal(latestAjesCountSummary(source,null),source);
 const exact={total:31,stale:false,observedAt,upperBound:false};
 assert.equal(latestAjesCountSummary(exact,source),exact);
 now=Date.parse('2026-11-28T08:30:01Z');
 const retained=latestAjesCountSummary(source,null)!;
 assert.equal(retained.stale,true);assert.equal(retained.observedAt,observedAt);
 assert.match(ajesCountLabel(retained,24),/^По последним данным: 46 в базе аукционов · данные на/);
 assert.equal(ajesVisibleCount(retained,24).status,'stale');
 assert.equal(exactAjesCount(retained),undefined);
 now=Date.parse('2026-12-05T08:00:00Z');
 assert.equal(latestAjesCountSummary(retained,null),null);
 assert.equal(ajesCountLabel(retained,24),'Количество уточняется');
});
