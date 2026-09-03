import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultGoodCarSearchBody,
  pageIdentityDisjoint,
  summarizeGoodCarSearchPayload,
} from '../scripts/catalog-source-chngoodcar-carslist-page-probe-v1.mjs';

test('Good Car default CarsList request reproduces source-declared no-filter pager values', () => {
  const body = new URLSearchParams(defaultGoodCarSearchBody(2));
  assert.equal(body.get('Hot'), 'false');
  assert.equal(body.get('DefaultSort'), '1');
  assert.equal(body.get('PriceSort'), '0');
  assert.equal(body.get('MileageSort'), '0');
  assert.equal(body.get('YearSort'), '0');
  assert.equal(body.get('pageindex'), '2');
  assert.equal(body.get('pagesize'), '15');
  for (const filter of ['Category','Price','Year','Mileage','Shape','Gearbox','Fuel','EmissionStandard','Steering','VehicleType','EngineModel']) {
    assert.equal(body.has(filter), false);
  }
});

test('Good Car search response summary stores scalar catalog evidence but not nested raw payloads', () => {
  const result = summarizeGoodCarSearchPayload({
    total: 31,
    rows: [
      { Id: '1001', Name: 'Test Car', Price: 9000, Year: '2023-01', Nested: { secret: 'not-copied' } },
      { Id: '1002', Name: 'Other Car', Price: 10000 },
    ],
  });
  assert.equal(result.total, 31);
  assert.equal(result.rowCount, 2);
  assert.deepEqual(result.rowIds, ['1001','1002']);
  assert.equal(result.rows[0].fields.Name, 'Test Car');
  assert.equal(result.rows[0].fields.Price, 9000);
  assert.equal('Nested' in result.rows[0].fields, false);
  assert.ok(result.rows[0].keys.includes('Nested'));
});

test('Good Car pagination identity check requires non-empty disjoint page IDs', () => {
  assert.equal(pageIdentityDisjoint({ summary: { rowIds: ['1','2'] } }, { summary: { rowIds: ['3','4'] } }), true);
  assert.equal(pageIdentityDisjoint({ summary: { rowIds: ['1','2'] } }, { summary: { rowIds: ['2','3'] } }), false);
  assert.equal(pageIdentityDisjoint({ summary: { rowIds: [] } }, { summary: { rowIds: ['3'] } }), false);
});
