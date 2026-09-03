import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('currency probe requires explicit CarsList US dollar label and no magnitude inference', () => {
  const source = fs.readFileSync('scripts/catalog-source-chngoodcar-currency-identity-v1.mjs', 'utf8');
  assert.match(source, /价格\\s\*\\\(\\s\*US\\s\*\\\$\\s\*\\\)/);
  assert.match(source, /currency:\s*match\s*\?\s*'USD'\s*:\s*null/);
  assert.match(source, /No numeric-magnitude inference is allowed/);
});

test('probe includes a public SUV offer for body diversity', () => {
  const source = fs.readFileSync('scripts/catalog-source-chngoodcar-currency-identity-v1.mjs', 'utf8');
  assert.match(source, /2049753443165270016/);
  assert.match(source, /马自达CX-50行也 2023款 2\.0L 领行版/);
  assert.match(source, /official_site_public_search_20260903/);
});

test('currency and identity probe is read-only', () => {
  const source = fs.readFileSync('scripts/catalog-source-chngoodcar-currency-identity-v1.mjs', 'utf8');
  assert.doesNotMatch(source, /publish-autocatalog|catalog-probe-source-shard|S3_BUCKET|YC_SERVICE_ACCOUNT|DATABASE_URL|POSTGRES_URL/i);
  assert.match(source, /productionWrites:\s*false/);
  assert.match(source, /classificationMutations:\s*false/);
  assert.match(source, /publishAllowedMutations:\s*false/);
  assert.match(source, /rawBodiesStored:\s*false/);
  assert.match(source, /guessedRoutes:\s*false/);
});
