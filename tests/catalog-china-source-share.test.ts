import test from 'node:test';
import assert from 'node:assert/strict';
import { selectChinaSourceShare, selectCatalogPublicationMix } from '../apps/web/lib/catalog/china-source-share';
import { catalogPowerBand } from '../apps/web/lib/catalog/power-mix';
const row = (id:string, sourceId='autohome_used_china_open', extra:any={}) =>
  ({id, market:'china', year:2026, sourceId, catalogPricingMode:'seller', ...extra}) as any;
const auto = (id:string, extra:any={}) => row(id,'autohome_new_china_open',extra);

test('Autohome never fills an empty China market or more than ten percent of final rows', () => {
  assert.equal(selectChinaSourceShare([auto('a')]).rows.length,0);
  for (const count of [0,1,8,9,11,18,90,101]) {
    const others=Array.from({length:count},(_,i)=>row('other'+i));
    const input=[...others,...Array.from({length:100},(_,i)=>auto('a'+i))];
    const result=selectChinaSourceShare(input);
    assert.equal(result.report.china.autohome,Math.floor(count/9));
    assert.ok(result.report.china.actualShare<=0.1);
    assert.deepEqual(result.rows.filter(r=>r.sourceId!=='autohome_new_china_open'),others);
    assert.equal(input.length,count+100);
  }
});
test('old or used retained Autohome cannot consume the allowance; other markets stay unchanged', () => {
  const others=Array.from({length:9},(_,i)=>row('o'+i));
  const foreign=[row('k','encar_direct',{market:'korea'}),row('j','drom_japan_stat',{market:'japan',year:2010})];
  const result=selectChinaSourceShare([auto('old',{year:2025}),auto('used',{mileageKm:10}),...foreign,...others,auto('new')]);
  assert.deepEqual(result.removed.map(r=>r.id),['old','used']);
  assert.deepEqual(result.rows.slice(0,2),foreign);
  assert.equal(result.report.china.autohome,1);
});
test('power removals cannot make Autohome exceed ten percent afterwards', () => {
  const rows=[row('low','autohome_used_china_open',{powerHp:100}),
    ...Array.from({length:8},(_,i)=>row('high'+i,'guazi_china_open',{powerHp:300})),auto('alow',{powerHp:100})];
  const result=selectCatalogPublicationMix(rows,true);
  assert.deepEqual(result.rows.map(r=>r.id),['low']);
  assert.equal(result.sourceShare.removed.length,1);
  assert.equal(result.powerMix.removed.length,8);
  assert.ok(result.sourceShare.report.china.actualShare<=0.1);
  assert.equal(result.rows.filter(r=>catalogPowerBand(r)==='low').length,1);
  assert.deepEqual(selectCatalogPublicationMix(result.rows,true).rows,result.rows);
});
test('both public policies hold with seller unknowns, several sources and Japan', () => {
  const japan=row('j','drom_japan_stat',{market:'japan',powerHp:400});
  const rows=[japan,...Array.from({length:30},(_,i)=>row('s'+i)),
    ...Array.from({length:8},(_,i)=>row('l'+i,'dongchedi_china_open',{powerHp:150})),
    ...Array.from({length:5},(_,i)=>row('h'+i,'guazi_china_open',{powerHp:300})),
    ...Array.from({length:25},(_,i)=>auto('a'+i))];
  const result=selectCatalogPublicationMix(rows,true);
  assert.ok(result.rows.includes(japan));
  assert.equal(result.rows.filter(r=>r.id.startsWith('s')).length,30);
  assert.ok(result.sourceShare.report.china.actualShare<=0.1);
  const band=result.powerMix.report.china as any;
  assert.ok(band.low>=4*band.high);
  assert.equal(result.rows.length+result.sourceShare.removed.length+result.powerMix.removed.length,rows.length);
});
