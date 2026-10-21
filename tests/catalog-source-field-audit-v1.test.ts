import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { extractLabelPairs, extractVisibleNamedFields, sourceOfferIdFromUrl } from '../scripts/catalog-source-field-audit-v1.mjs';

test('sourceOfferIdFromUrl extracts query and terminal listing ids', () => {
  assert.equal(sourceOfferIdFromUrl('https://www.bobaedream.co.kr/mycar/mycar_view.php?no=2262188&gubun=K'), '2262188');
  assert.equal(sourceOfferIdFromUrl('https://www.dubicars.com/2023-bmw-ix1-979972.html'), '979972');
  assert.equal(sourceOfferIdFromUrl('https://carswitch.com/abudhabi/used-car/dodge/durango/2013/857416'), '857416');
  assert.equal(sourceOfferIdFromUrl('https://www.cars24.ae/buy-used-ford-territory-2024-cars-dubai-9714841918/'), '9714841918');
});

test('label pair extraction preserves named source-bound values', () => {
  const html = '<table><tr><th>Horsepower</th><td>313 HP</td></tr><tr><td>Fuel Type</td><td>Electric</td></tr></table><dl><dt>Model year</dt><dd>2023</dd></dl>';
  assert.deepEqual(extractLabelPairs(html), [
    { label: 'Horsepower', value: '313 HP', source: 'table' },
    { label: 'Fuel Type', value: 'Electric', source: 'table' },
    { label: 'Model year', value: '2023', source: 'dl' },
  ]);
});

test('visible named extraction binds DubiCars-style specs instead of loose page words', () => {
  const html = '<div>Make</div><div>BMW</div><div>Model</div><div>iX1</div><div>Horsepower</div><div>313 HP</div><div>Vehicle type</div><div>SUV/Crossover</div><div>Fuel Type</div><div>Electric</div>';
  const hits = extractVisibleNamedFields(html);
  assert.ok(hits.make.some((row) => row.value === 'BMW'));
  assert.ok(hits.model.some((row) => row.value === 'iX1'));
  assert.ok(hits.power.some((row) => row.value === '313 HP'));
  assert.ok(hits.body.some((row) => row.value === 'SUV/Crossover'));
  assert.ok(hits.fuel.some((row) => row.value === 'Electric'));
});

test('visible compound extraction recovers Bobaedream displacement and horsepower', () => {
  const html = '<table><tr><th>연식</th><td>2016.04 배기량 3,342 cc (282마력)</td></tr><tr><th>연료</th><td>가솔린</td></tr></table>';
  const hits = extractVisibleNamedFields(html);
  assert.ok(hits.year.some((row) => row.value === '2016'));
  assert.ok(hits.engine.some((row) => row.value === '3,342 cc'));
  assert.ok(hits.power.some((row) => row.value === '282 마력'));
});

test('field audit is isolated from production writers and mutations', () => {
  const source = fs.readFileSync('scripts/catalog-source-field-audit-v1.mjs', 'utf8');
  assert.doesNotMatch(source, /publish-autocatalog|catalog-probe-source-shard|S3_BUCKET|YC_SERVICE_ACCOUNT|DATABASE_URL|POSTGRES_URL/i);
  assert.match(source, /productionWrites:\s*false/);
  assert.match(source, /classificationMutations:\s*false/);
  assert.match(source, /publishAllowedMutations:\s*false/);
  assert.match(source, /rawBodiesStored:\s*false/);
});

test('audit sample set is fixed to the four strongest evidence candidates', () => {
  const source = fs.readFileSync('scripts/catalog-source-field-audit-v1.mjs', 'utf8');
  for (const id of ['dubicars_uae_exact', 'bobaedream_korea_candidate', 'carswitch_uae_candidate', 'cars24_uae_candidate']) assert.match(source, new RegExp(id));
});
