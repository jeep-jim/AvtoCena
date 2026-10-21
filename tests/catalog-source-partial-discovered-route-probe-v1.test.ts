import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { extractFieldContexts } from '../scripts/catalog-source-partial-discovered-route-probe-v1.mjs';

test('field contexts retain source-near power, charging and engine evidence', () => {
  const html = '<div>最大马力 37 Ps 最大功率 27kW 快充时间 1.5h</div><div>排量 2.0L</div>';
  const fields = extractFieldContexts(html);
  assert.ok(fields.power.some((x: any) => /37 Ps|27kW/i.test(x.context)));
  assert.ok(fields.charging.some((x: any) => /快充/.test(x.context)));
  assert.ok(fields.engine.some((x: any) => /2\.0L/.test(x.context)));
});

test('probe contains only routes discovered by the prior green audit', () => {
  const source = fs.readFileSync('scripts/catalog-source-partial-discovered-route-probe-v1.mjs', 'utf8');
  assert.match(source, /1265916925100158976/);
  assert.match(source, /1265916910290071552/);
  assert.match(source, /1288729215201439744/);
  assert.match(source, /configuration-15501828/);
  assert.match(source, /routeOrigin:\s*'discovered_in_run_33747985524'/);
  assert.match(source, /guessedRoutes:\s*false/);
});

test('discovered-route probe is isolated from production writers and mutations', () => {
  const source = fs.readFileSync('scripts/catalog-source-partial-discovered-route-probe-v1.mjs', 'utf8');
  assert.doesNotMatch(source, /publish-autocatalog|catalog-probe-source-shard|S3_BUCKET|YC_SERVICE_ACCOUNT|DATABASE_URL|POSTGRES_URL/i);
  assert.match(source, /productionWrites:\s*false/);
  assert.match(source, /classificationMutations:\s*false/);
  assert.match(source, /publishAllowedMutations:\s*false/);
  assert.match(source, /rawBodiesStored:\s*false/);
});
