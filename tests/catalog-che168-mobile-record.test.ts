import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseChe168MobileRecord } from '../scripts/lib/che168-mobile-record.mjs';

const fixture = (id: string) => JSON.parse(readFileSync(new URL(`../data/catalog/research/che168-mobile-20260912/${id}.json`, import.meta.url), 'utf8'));
test('real mobile Lavida binds cash price, exact cc, power and its own gallery', () => {
  const r = parseChe168MobileRecord(fixture('58328510'), '58328510');
  assert.equal(r.sourcePrice, 76800); assert.equal(r.engineCc, 1498);
  assert.equal(r.powerHp, 110); assert.equal(r.powerKw, 81); assert.equal(r.fuel, 'petrol');
  assert.equal(r.mileageKm, 29000); assert.equal(r.imageUrls.length, 16);
  assert.equal(r.firstRegistrationMonth, '2023-05'); assert.equal(r.productionDate, undefined);
  assert.equal(r.calculationStatus, 'needs_data'); assert.equal(r.totalRub, null);
  assert.ok(r.stopReasons.includes('production_date_unconfirmed'));
});
test('real BMW mild hybrid retains ICE table without inventing utilization power', () => {
  const r = parseChe168MobileRecord(fixture('59859616'), '59859616');
  assert.equal(r.sourcePrice, 428000); assert.equal(r.engineCc, 1998);
  assert.equal(r.powerHp, 258); assert.equal(r.powerKw, 190); assert.equal(r.fuel, 'hybrid');
  assert.equal(r.mileageKm, 24000); assert.equal(r.imageUrls.length, 23);
  assert.ok(r.stopReasons.includes('utilization_power_unconfirmed'));
});
test('rejects wrong identity, Global, multiple IDs, title mismatch and ambiguous tables', () => {
  for (const change of [
    {sourceUrl:'https://global.che168.com/en/detail/58328510'},
    {sourceUrl:'https://m.che168.com/cardetail/index?infoid=58328510&infoid=59859616'},
    {mainTitle:'another car'}, {modelTableCount:2},
  ]) assert.throws(() => parseChe168MobileRecord({...fixture('58328510'),...change}, '58328510'));
  assert.throws(() => parseChe168MobileRecord(fixture('58328510'), '1'));
});
test('down payment, MSRP and comparison prices cannot substitute for cash price', () => {
  for (const cashPriceBoxes of [[], ['2.3万首付'], ['13.09万厂商指导价(元)'], ['7.68万全款价格','8.58万全款价格']])
    assert.throws(() => parseChe168MobileRecord({...fixture('58328510'),cashPriceBoxes}, '58328510'));
});
test('missing exact cc stays missing; conflicting power clears the affected evidence', () => {
  const a=fixture('58328510'); a.rows=a.rows.filter(([k]:string[]) => k!=='排量(mL)');
  assert.equal(parseChe168MobileRecord(a,'58328510').engineCc,undefined);
  const b=fixture('58328510'); b.rows.push(['最大马力(Ps)','150']);
  assert.equal(parseChe168MobileRecord(b,'58328510').powerHp,undefined);
  const c=fixture('58328510'); c.rows=c.rows.map(([k,v]:string[])=>[k,k==='最大马力(Ps)'?'150':v]);
  const r=parseChe168MobileRecord(c,'58328510'); assert.equal(r.powerHp,undefined); assert.equal(r.powerKw,undefined);
  assert.ok(r.stopReasons.includes('power_units_conflict'));
});
test('rejects gallery contamination and keeps every source table row', () => {
  const a=fixture('58328510'); a.gallery.urls.push('https://example.org/recommendation.jpg');
  assert.throws(()=>parseChe168MobileRecord(a,'58328510'));
  const b=fixture('58328510'); const r=parseChe168MobileRecord(b,'58328510');
  assert.deepEqual(r.tableRows,b.rows); assert.deepEqual(r.raw,b);
  const bmw=parseChe168MobileRecord(fixture('59859616'),'59859616');
  assert.equal(bmw.tableRows.length,205);
  assert.ok(bmw.tableRows.some(([label])=>label==='车内PM2.5过滤装置'));
});
