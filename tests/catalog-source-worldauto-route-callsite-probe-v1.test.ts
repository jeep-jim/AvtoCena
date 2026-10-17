import assert from 'node:assert/strict';
import test from 'node:test';
import { extractWorldAutoCallsites } from '../scripts/catalog-source-worldauto-route-callsite-probe-v1.mjs';

test('extracts declared route method and nearby parameter signals without turning them into a request contract', () => {
  const js = `
    function loadCar(e){ return client.get('/car/get',{params:{id:e,lang:'en'}}) }
    function loadSell(e){ return client.post('/sell/car/get',{data:{advertId:e}}) }
  `;
  const rows = extractWorldAutoCallsites(js);
  const car = rows.find((row) => row.route === '/car/get');
  const sell = rows.find((row) => row.route === '/sell/car/get');
  assert.ok(car);
  assert.ok(sell);
  assert.ok(car.methodSignals.includes('GET'));
  assert.ok(sell.methodSignals.includes('POST'));
  // Nearby keys are deliberately only hints from a bounded minified-code window.
  // The classifier must not treat them as an exact request contract without a later route-specific proof.
  assert.ok(car.nearbyParameterKeys.includes('id'));
  assert.ok(car.nearbyParameterKeys.includes('lang'));
  assert.ok(sell.nearbyParameterKeys.includes('advertId'));
});

test('keeps literal evidence when method/parameter contract is absent', () => {
  const rows = extractWorldAutoCallsites(`const route='/car/get';`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].route, '/car/get');
  assert.deepEqual(rows[0].methodSignals, []);
  assert.deepEqual(rows[0].nearbyParameterKeys, []);
});

test('scrubs token-like query values from stored context', () => {
  const rows = extractWorldAutoCallsites(`client.get('/car/get?token=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789&id=42')`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].context.includes('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'), false);
});
