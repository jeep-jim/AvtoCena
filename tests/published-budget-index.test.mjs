import assert from 'node:assert/strict';
import test from 'node:test';
import {canReusePublishedBudget} from '../scripts/lib/published-budget-index.mjs';
import {stagedBudgetDigest} from '../scripts/lib/catalog-staged-budget.mjs';

const generationId = 'gen_1790001000000_def12345';
const digest = 'd'.repeat(64);
const manifest = {version:2, generationId, markets:{europe:{count:2,chunks:['items']}}};
const identity = {release:'a'.repeat(40), calculationVersion:'b'.repeat(64)};
const market = {sourceRows:2, fingerprint:digest, selectorChecksum:digest, sourceIds:digest,
  coverage:{projectionRows:2, selectorRows:2, eligibleRows:2, projectionIds:digest, eligibleIds:digest},
  budget:{rows:1, checksum:digest}, sort:{rows:2, checksum:digest}};
const report = {version:1, verified:true, published:false, ...identity, generationId,
  manifestDigest:stagedBudgetDigest(manifest), encyclopediaDigest:digest, utcDay:'2026-11-22', policyDay:'2026-11-23',
  markets:{europe:market}};
const input = {report, identity, manifest, encyclopediaDigest:digest, selectors:{generationId, valid:true},
  rootPresent:true, now:Date.parse('2026-11-22T18:00:00Z')};

test('reuse a verified publisher receipt only against the independently visible index', () => {
  assert.equal(canReusePublishedBudget(input), true);
  for (const override of [
    {report:null}, {selectors:{generationId,valid:false}}, {rootPresent:false}, {selectors:{generationId:'old',valid:true}},
    {encyclopediaDigest:'f'.repeat(64)}, {identity:{...identity,release:'c'.repeat(40)}},
    {manifest:{...manifest,markets:{europe:{count:3,chunks:['items']}}}}, {report:{...report,markets:{}}},
    {now:Date.parse('2026-11-23T03:00:00Z')}, {now:Date.parse('2026-11-22T12:00:00Z')},
  ]) assert.equal(canReusePublishedBudget({...input,...override}),false);
});
