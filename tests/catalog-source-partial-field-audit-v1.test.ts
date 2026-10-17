import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { pageRoleDiagnostics } from '../scripts/catalog-source-partial-field-audit-v1.mjs';

test('statistics and heavy-machinery pages are flagged as role concerns', () => {
  const role = pageRoleDiagnostics({
    title: 'Statistics for Hitachi EX55UR-3 1998 – Starting at 750,000 JPY',
    html: '<h1>Auction statistics</h1><p>Hitachi EX55UR-3 construction machinery</p>',
    imageCount: 1,
  });
  assert.equal(role.statisticsLanguage, true);
  assert.equal(role.heavyMachineryLanguage, true);
  assert.equal(role.oneOrFewerImages, true);
});

test('ordinary exact vehicle detail is not marked as generic shell', () => {
  const role = pageRoleDiagnostics({
    title: '2020 BMW 3 Series used car',
    html: '<h1>2020 BMW 3 Series</h1><p>2.0L petrol sedan</p>',
    imageCount: 12,
  });
  assert.equal(role.genericShellTitle, false);
  assert.equal(role.oneOrFewerImages, false);
});

test('partial audit is fixed to four known samples and does not guess routes', () => {
  const source = fs.readFileSync('scripts/catalog-source-partial-field-audit-v1.mjs', 'utf8');
  for (const id of [
    'carvector_japan_stat_open',
    'chngoodcar_china_candidate',
    'iautos_china_candidate',
    'exportcar_japan_candidate',
  ]) assert.match(source, new RegExp(id));
  assert.match(source, /guessedRoutes:\s*false/);
  assert.match(source, /sourceCount:\s*SAMPLES\.length/);
});

test('partial audit is isolated from production writers and classification mutations', () => {
  const source = fs.readFileSync('scripts/catalog-source-partial-field-audit-v1.mjs', 'utf8');
  assert.doesNotMatch(source, /publish-autocatalog|catalog-probe-source-shard|S3_BUCKET|YC_SERVICE_ACCOUNT|DATABASE_URL|POSTGRES_URL/i);
  assert.match(source, /productionWrites:\s*false/);
  assert.match(source, /classificationMutations:\s*false/);
  assert.match(source, /publishAllowedMutations:\s*false/);
  assert.match(source, /rawBodiesStored:\s*false/);
});
