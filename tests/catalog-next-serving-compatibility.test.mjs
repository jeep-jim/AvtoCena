import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {verifyServingCompatibility} from '../scripts/catalog-next/serving-compatibility.mjs';

const hash = raw => createHash('sha256').update(raw).digest('hex');
async function fixture(t) {
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'china-serving-'));
  t.after(() => fs.rm(runtimeRoot, {recursive: true, force: true}));
  const git = args => execFileSync('/usr/bin/git', args,
    {cwd: runtimeRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  const write = async (name, text) => {
    await fs.mkdir(path.dirname(path.join(runtimeRoot, name)), {recursive: true});
    await fs.writeFile(path.join(runtimeRoot, name), text);
  };
  const commit = () => {
    git(['add', '.']); git(['-c', 'user.email=fixture@example.invalid', '-c', 'user.name=Fixture',
      'commit', '--no-gpg-sign', '-m', 'fixture']);
  };
  git(['init', '--quiet']);
  await write('apps/web/lib/catalog/storage.ts', 'original reader\n');
  await write('apps/web/lib/catalog/rates.ts', 'unchanged frozen pricing\n');
  await write('apps/web/lib/catalog/offer-page-data.ts', 'export const offer = async (id: string) => ({id});\n');
  await write('packages/engine/price.ts', 'unchanged formula\n');
  commit();
  const pricingPlan = {version: 1, market: 'china', minimumYear: 2014,
    runtimeSha: git(['rev-parse', 'HEAD']).trim(), runtimeTree: git(['rev-parse', 'HEAD^{tree}']).trim()};
  const servingPlan = () => ({version: 1, market: 'china', runtimeSha: git(['rev-parse', 'HEAD']).trim(),
    runtimeTree: git(['rev-parse', 'HEAD^{tree}']).trim(), pricingRuntimeSha: pricingPlan.runtimeSha,
    pricingRuntimeTree: pricingPlan.runtimeTree,
    pricingToServingDiffSha256: hash(git(['diff', '--binary', '--no-ext-diff', '--no-renames', pricingPlan.runtimeSha, 'HEAD'])),
    pricingToServingFiles: git(['diff', '--name-only', '--no-renames', pricingPlan.runtimeSha, 'HEAD']).trim().split('\n').filter(Boolean)});
  return {runtimeRoot, git, write, commit, pricingPlan, servingPlan};
}

test('the identical serving/pricing runtime is valid with an exact empty diff', async t => {
  const f = await fixture(t);
  const proof = await verifyServingCompatibility({...f, servingPlan: f.servingPlan()});
  assert.equal(proof.runtimeSha, proof.pricingRuntimeSha);
  assert.equal(proof.pricingToServingDiffSha256, hash(''));
  assert.deepEqual(proof.pricingToServingFiles, []);
  assert.equal(proof.protectedPricingPathsUnchanged, true);
});

test('an exact descendant may change only the reviewed serving readers and targeted tests', async t => {
  const f = await fixture(t);
  await f.write('apps/web/lib/catalog/storage.ts', 'reviewed independent reader\n');
  await f.write('apps/web/app/api/catalog/home/route.ts', 'reviewed home reader\n');
  await f.write('apps/web/app/(public)/page.tsx', 'reviewed home SSR fallback\n');
  await f.write('apps/web/lib/catalog/china-local-reader.ts', 'reviewed prepared city reader\n');
  await f.write('apps/web/lib/catalog/china-city-query.mjs', 'reviewed read-only city selection\n');
  await f.write('tests/catalog-next-home.test.ts', 'reviewed reader assertion\n'); f.commit();
  const proof = await verifyServingCompatibility({...f, servingPlan: f.servingPlan()});
  assert.notEqual(proof.runtimeSha, proof.pricingRuntimeSha);
  assert.deepEqual(proof.pricingToServingFiles, ['apps/web/app/(public)/page.tsx', 'apps/web/app/api/catalog/home/route.ts',
    'apps/web/lib/catalog/china-city-query.mjs', 'apps/web/lib/catalog/china-local-reader.ts',
    'apps/web/lib/catalog/storage.ts', 'tests/catalog-next-home.test.ts']);
  assert.equal(proof.pricingRuntimeSha, f.pricingPlan.runtimeSha);
  assert.equal(proof.protectedPricingPathsUnchanged, true);
});

test('the exact range-control component and its isolated browser fixture may preserve prepared pricing', async t => {
  const f = await fixture(t);
  const files = ['apps/web/components/catalog/CatalogFilters.tsx', 'tests/browser/catalog-range-commit-fixture.tsx',
    'tests/browser/catalog-range-commit.mjs'];
  for (const filename of files) await f.write(filename, 'reviewed committed-range behavior\n');
  f.commit();
  const proof = await verifyServingCompatibility({...f, servingPlan: f.servingPlan()});
  assert.deepEqual(proof.pricingToServingFiles, files);
  assert.equal(proof.protectedPricingPathsUnchanged, true);
});

test('pricing, data, worker, encyclopedia and broad runtime changes are refused even when their diff is pinned', async t => {
  const f = await fixture(t);
  for (const filename of ['apps/web/lib/catalog/rates.ts', 'packages/engine/price.ts', 'data/private.json',
    'scripts/catalog-next/pricing-generation.mjs', 'scripts/catalog-next/query-index.mjs',
    'scripts/catalog-next/query-semantics.mjs', 'apps/web/lib/encyclopedia/calculation-index.ts', 'apps/web/app/api/other/route.ts',
    'apps/web/components/catalog/UnreviewedFilters.tsx', 'tests/browser/owner-filter-speed-live.mjs']) {
    await f.write(filename, 'unapproved pricing or unrelated change\n'); f.commit();
    await assert.rejects(verifyServingCompatibility({...f, servingPlan: f.servingPlan()}), /china_serving_change_scope/);
    f.git(['reset', '--hard', f.pricingPlan.runtimeSha]);
  }
});

test('mismatched pricing identity, tree, literal diff or changed file list are refused', async t => {
  const f = await fixture(t);
  await f.write('apps/web/lib/catalog/storage.ts', 'new reader\n'); f.commit();
  const plan = f.servingPlan();
  for (const changed of [{pricingRuntimeSha: 'a'.repeat(40)}, {pricingRuntimeTree: 'b'.repeat(40)},
    {pricingToServingDiffSha256: 'c'.repeat(64)}, {pricingToServingFiles: []}]) {
    await assert.rejects(verifyServingCompatibility({...f, servingPlan: {...plan, ...changed}}), /china_serving_/);
  }
  await assert.rejects(verifyServingCompatibility({...f, servingPlan: {...plan, pricingRuntimeTree: 'd'.repeat(40)},
    pricingPlan: {...f.pricingPlan, runtimeTree: 'd'.repeat(40)}}), /china_serving_pricing_tree/);
});

test('a local edit is refused and remains untouched', async t => {
  const f = await fixture(t), servingPlan = f.servingPlan();
  await f.write('apps/web/lib/catalog/storage.ts', 'local unreviewed edit\n');
  await assert.rejects(verifyServingCompatibility({...f, servingPlan}), /china_serving_git_failed/);
  assert.equal(await fs.readFile(path.join(f.runtimeRoot, 'apps/web/lib/catalog/storage.ts'), 'utf8'), 'local unreviewed edit\n');
});

test('the offer reader exception accepts type annotations only and binds the identical emitted JavaScript', async t => {
  const f = await fixture(t);
  await f.write('apps/web/lib/catalog/offer-page-data.ts',
    'import type {Offer} from "./types";\nexport const offer = async (id: string): Promise<Offer> => ({id});\n');
  f.commit();
  const proof = await verifyServingCompatibility({...f, servingPlan: f.servingPlan()});
  assert.equal(proof.typeOnlyChecks.length, 1);
  assert.equal(proof.typeOnlyChecks[0].file, 'apps/web/lib/catalog/offer-page-data.ts');
  assert.match(proof.typeOnlyChecks[0].emittedJavaScriptSha256, /^[a-f0-9]{64}$/);
  assert.match(proof.typeOnlyChecks[0].compilerVersion, /^\d+\.\d+\.\d+/);
  await f.write('apps/web/lib/catalog/offer-page-data.ts',
    'export const offer = async (id: string) => ({id, changedRuntimeBehavior: true});\n');
  f.commit();
  await assert.rejects(verifyServingCompatibility({...f, servingPlan: f.servingPlan()}), /type_only_runtime_changed/);
});
