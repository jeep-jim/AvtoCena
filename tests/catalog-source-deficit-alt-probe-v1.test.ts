import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('alternate probe is fixed to routes discovered by the prior green artifact', () => {
  const source = fs.readFileSync('scripts/catalog-source-deficit-alt-probe-v1.mjs', 'utf8');
  assert.match(source, /2260063/);
  assert.match(source, /class_no=26958/);
  assert.match(source, /2262188/);
  assert.match(source, /class_no=25294/);
  assert.match(source, /routeOrigin:\s*'discovered_in_run_33744960785'/);
  assert.match(source, /guessedRoutes:\s*false/);
});

test('alternate probe remains read-only and isolated from production writers', () => {
  const source = fs.readFileSync('scripts/catalog-source-deficit-alt-probe-v1.mjs', 'utf8');
  assert.doesNotMatch(source, /publish-autocatalog|catalog-probe-source-shard|S3_BUCKET|YC_SERVICE_ACCOUNT|DATABASE_URL|POSTGRES_URL/i);
  assert.match(source, /productionWrites:\s*false/);
  assert.match(source, /classificationMutations:\s*false/);
  assert.match(source, /publishAllowedMutations:\s*false/);
  assert.match(source, /rawBodiesStored:\s*false/);
});
