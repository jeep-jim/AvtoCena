import test from 'node:test';
import assert from 'node:assert/strict';
import {withRateChartHistory} from '../apps/web/lib/catalog/rate-chart-history';
const history=[17,18,19,20,22].map(day=>({date:`2026-09-${day}`,effectiveRate:0.5+day/1000}));
test('saved quote receives five chart dates without changing its calculation rate',()=>{
 const saved={currency:'JPY',effectiveRate:.535299,previousEffectiveRate:.535949,rateDate:'2026-09-22',previousRateDate:'2026-09-19',history:history.slice(-2),sourcePrice:2000000};
 const result=withRateChartHistory(saved,{currency:'JPY',history});
 assert.equal(result.history.length,5);
 assert.equal(result.effectiveRate,saved.effectiveRate);assert.equal(result.previousEffectiveRate,saved.previousEffectiveRate);
 assert.equal(result.rateDate,saved.rateDate);assert.equal(result.sourcePrice,saved.sourcePrice);
 assert.equal(saved.history.length,2);
});
test('history never crosses currencies, invents dates or accepts invalid rates',()=>{
 const saved={currency:'JPY'};
 assert.equal(withRateChartHistory(saved,{currency:'USD',history}),saved);
 const result=withRateChartHistory(saved,{currency:'JPY',history:[...history,{date:'bad',effectiveRate:1},{date:'2026-09-23',effectiveRate:NaN}]});
 assert.deepEqual(result.history,history);
});
