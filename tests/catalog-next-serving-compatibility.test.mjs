import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {verifyServingCompatibility} from '../scripts/catalog-next/serving-compatibility.mjs';
import {JAPAN_RECOVERY_CODE_PATHS,JAPAN_COMPLETION_CODE_PATHS,JAPAN_COMPLETION_V2_CODE_PATHS,JAPAN_USABILITY_CODE_PATHS} from '../scripts/catalog-next/photo-code-scope.mjs';
import {CRM_CHINA_CODE_SCOPE, CRM_CHINA_CODE_PATHS} from '../scripts/catalog-next/crm-china-code-scope.mjs';
import {CRM_JAPAN_PHOTO_CODE_SCOPE, CRM_JAPAN_PHOTO_CODE_PATHS} from '../scripts/catalog-next/crm-japan-photo-code-scope.mjs';
import {JAPAN_PAGINATION_CODE_SCOPE,JAPAN_PAGINATION_CODE_PATHS} from '../scripts/catalog-next/japan-pagination-code-scope.mjs';
import {JAPAN_STABILITY_CODE_SCOPE,JAPAN_STABILITY_CODE_PATHS,JAPAN_STABILITY_UI_CODE_PATHS,
  JAPAN_STABILITY_RETAINED_RUNTIME,JAPAN_STABILITY_HOME_CODE_PATHS,JAPAN_STABILITY_METADATA_CODE_PATHS,
  JAPAN_OBSERVED_TIMING_POLICY} from '../scripts/catalog-next/japan-stability-code-scope.mjs';

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
    pricingToServingDiffSha256: hash(git(['diff', '--binary', '--full-index', '--no-ext-diff', '--no-renames', pricingPlan.runtimeSha, 'HEAD'])),
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

test('metadata TTL regression is a pricing-compatible path only in the exact 59-file successor', async t => {
  const f = await fixture(t);
  await f.write('tests/ajes-ready-metadata.test.ts', 'positive source TTL fixture\n'); f.commit();
  const plan = {...f.servingPlan(), codeScope: JAPAN_STABILITY_CODE_SCOPE, retainedRuntime: JAPAN_STABILITY_RETAINED_RUNTIME,
    runtimeFiles: [...JAPAN_STABILITY_METADATA_CODE_PATHS], acceptancePolicy: JAPAN_OBSERVED_TIMING_POLICY};
  const proof = await verifyServingCompatibility({...f, servingPlan: plan});
  assert.deepEqual(proof.pricingToServingFiles, ['tests/ajes-ready-metadata.test.ts']);
  assert.equal(proof.protectedPricingPathsUnchanged, true);
  await assert.rejects(verifyServingCompatibility({...f,
    servingPlan: {...plan, runtimeFiles: [...JAPAN_STABILITY_HOME_CODE_PATHS]}}), /china_serving_change_scope/);
});

for (const [scope, paths] of [[CRM_CHINA_CODE_SCOPE, CRM_CHINA_CODE_PATHS], [CRM_JAPAN_PHOTO_CODE_SCOPE, CRM_JAPAN_PHOTO_CODE_PATHS]])
test('CRM compatibility excludes b25 and adjacent controls: ' + scope, async t => {
  const f = await fixture(t);
  for (const filename of [...JAPAN_COMPLETION_V2_CODE_PATHS, ...paths]) await f.write(filename, 'reviewed cumulative bytes\n');
  f.commit();
  const proof = await verifyServingCompatibility({...f, servingPlan: {...f.servingPlan(), codeScope: scope}});
  assert.equal(proof.protectedPricingPathsUnchanged, true);
  for (const codeScope of ['catalog-japan-completion-v2', 'catalog-japan-usability-v1'])
    await assert.rejects(verifyServingCompatibility({...f, servingPlan: {...f.servingPlan(), codeScope}}), /china_serving_change_scope/);
  if (scope === CRM_JAPAN_PHOTO_CODE_SCOPE)
    await assert.rejects(verifyServingCompatibility({...f, servingPlan: {...f.servingPlan(), codeScope: CRM_CHINA_CODE_SCOPE}}), /china_serving_change_scope/);
  for (const filename of ['apps/web/lib/catalog/ajes-power-page.ts', 'apps/web/lib/catalog/china-local-reader-new.ts',
    'apps/web/app/(crm)/api/crm/team/route.ts', 'apps/web/components/site/BusinessSettings.tsx',
    'apps/web/lib/auth.ts', 'apps/web/lib/catalog/rates.ts', 'tests/china-unreviewed.test.ts']) {
    await f.write(filename, 'unreviewed bytes\n'); f.commit();
    await assert.rejects(verifyServingCompatibility({...f, servingPlan: {...f.servingPlan(), codeScope: scope}}), /china_serving_change_scope/);
    f.git(['reset', '--hard', 'HEAD~1']);
  }
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

test('Japan recovery permits its exact reviewed application/tests and retained China reader delta', async t => {
  const f = await fixture(t);
  const files = [...new Set([...JAPAN_RECOVERY_CODE_PATHS,
    'apps/web/app/api/catalog/home/route.ts', 'apps/web/components/catalog/CatalogFilters.tsx',
    'apps/web/components/catalog/CatalogPrice.tsx', 'apps/web/components/catalog/InlineOfferParameters.tsx',
    'apps/web/lib/catalog/china-city-query.mjs', 'apps/web/lib/catalog/china-local-reader.ts',
    'apps/web/lib/catalog/home-phase-timing.ts', 'apps/web/lib/catalog/offer-page-data.ts',
    'apps/web/lib/catalog/prepared-china-detail-city.ts', 'apps/web/lib/dealers/public-showcase.ts',
    'apps/web/lib/location/selected-city.ts', 'tests/browser/catalog-range-commit-fixture.tsx',
    'tests/browser/catalog-range-commit.mjs', 'tests/catalog-next-home-phase-timing.test.ts',
    'tests/catalog-next-local-reader.test.ts', 'tests/catalog-next-query-index.test.ts'])].sort();
  assert.equal(files.length, 53);
  for (const name of files) await f.write(name, name === 'apps/web/lib/catalog/offer-page-data.ts'
    ? 'import type {Offer} from "./types";\nexport const offer = async (id: string): Promise<Offer> => ({id});\n'
    : 'reviewed Japan recovery and retained China behavior\n');
  f.commit();
  const proof = await verifyServingCompatibility({...f, servingPlan: {...f.servingPlan(), codeScope: 'catalog-japan-recovery-v1'}});
  assert.deepEqual(proof.pricingToServingFiles, files);
  assert.equal(proof.protectedPricingPathsUnchanged, true);
  assert.equal(proof.typeOnlyChecks.length, 1, 'the retained annotation still requires identical emitted JavaScript');
});

test('Japan recovery never admits another application or test path through a broad allowance', async t => {
  const f = await fixture(t);
  for (const filename of ['apps/web/components/home/UnreviewedJapanRail.tsx', 'tests/japan-unreviewed.test.ts',
    'tests/catalog-next-home.test.ts', 'apps/web/components/catalog/JapanSourcePowerNotice.tsx',
    'tests/japan-pw-first.test.ts', 'tests/browser/catalog-photo-recovery.mjs', 'apps/web/lib/catalog/rates.ts']) {
    await f.write(filename, 'unreviewed delta\n'); f.commit();
    await assert.rejects(verifyServingCompatibility({...f,
      servingPlan: {...f.servingPlan(), codeScope: 'catalog-japan-recovery-v1'}}), /china_serving_change_scope/);
    f.git(['reset', '--hard', f.pricingPlan.runtimeSha]);
  }
});

test('Japan completion permits only its reviewed additions to the retained serving delta',async t=>{
  const f=await fixture(t),files=[...new Set([...JAPAN_RECOVERY_CODE_PATHS,...JAPAN_COMPLETION_CODE_PATHS])].sort();
  for(const filename of files)await f.write(filename,'reviewed Japan successor\n');
  f.commit();
  const proof=await verifyServingCompatibility({...f,servingPlan:{...f.servingPlan(),codeScope:'catalog-japan-completion-v1'}});
  assert.deepEqual(proof.pricingToServingFiles,files);assert.equal(proof.protectedPricingPathsUnchanged,true);
  for(const codeScope of ['catalog-japan-recovery-v1','catalog-photo-recovery-v1','catalog-photo-japan-power-v1'])
    await assert.rejects(verifyServingCompatibility({...f,servingPlan:{...f.servingPlan(),codeScope}}),/china_serving_change_scope/);
});

for(const scope of ['catalog-japan-completion-v1','catalog-japan-completion-v2','catalog-japan-usability-v1'])
test(scope+' retains protected pricing and refuses a neighbouring unreviewed change',async t=>{
  const f=await fixture(t);
  for(const filename of ['apps/web/lib/catalog/customs-pricing.ts','apps/web/lib/catalog/live-business-pricing.ts',
    'apps/web/lib/catalog/city-delivery.ts','apps/web/lib/encyclopedia/calculation-index.ts','tests/japan-unreviewed.test.ts']){
    await f.write(filename,'unreviewed delta\n');f.commit();
    await assert.rejects(verifyServingCompatibility({...f,servingPlan:{...f.servingPlan(),codeScope:scope}}),/china_serving_change_scope/);
    f.git(['reset','--hard',f.pricingPlan.runtimeSha]);
  }
});

test('completion v2 permits its exact cumulative proof without broadening completion v1 or older profiles',async t=>{
  const f=await fixture(t),files=[...new Set([...JAPAN_RECOVERY_CODE_PATHS,...JAPAN_COMPLETION_V2_CODE_PATHS])].sort();
  for(const filename of files)await f.write(filename,'reviewed Japan empty-page proof successor\n');
  f.commit();
  const proof=await verifyServingCompatibility({...f,servingPlan:{...f.servingPlan(),codeScope:'catalog-japan-completion-v2'}});
  assert.deepEqual(proof.pricingToServingFiles,files);assert.equal(proof.protectedPricingPathsUnchanged,true);
  for(const codeScope of ['catalog-japan-completion-v1','catalog-japan-recovery-v1','catalog-photo-recovery-v1','catalog-photo-japan-power-v1'])
    await assert.rejects(verifyServingCompatibility({...f,servingPlan:{...f.servingPlan(),codeScope}}),/china_serving_change_scope/);
  await f.write('apps/web/lib/catalog/ajes-query-cache.ts','unreviewed adjacent cache file\n');f.commit();
  await assert.rejects(verifyServingCompatibility({...f,servingPlan:{...f.servingPlan(),codeScope:'catalog-japan-completion-v2'}}),/china_serving_change_scope/);
});

test('the new Japan allowlist does not broaden either older photo profile', async t => {
  const f = await fixture(t);
  await f.write('apps/web/components/catalog/JapanRailFrame.tsx', 'Japan recovery only\n'); f.commit();
  for (const codeScope of ['catalog-photo-recovery-v1', 'catalog-photo-japan-power-v1']) {
    await assert.rejects(verifyServingCompatibility({...f, servingPlan: {...f.servingPlan(), codeScope}}), /china_serving_change_scope/);
  }
});

test('canonical serving bytes verify across short and full Git abbreviations without changing source', async t => {
  const f = await fixture(t);
  await f.write('apps/web/lib/catalog/storage.ts', 'reviewed independent reader\n'); f.commit();
  const source = f.git(['ls-files', '--stage']);
  f.git(['config', 'core.abbrev', '7']);
  const plan = f.servingPlan();
  const abbreviated = hash(f.git(['diff', '--binary', '--no-ext-diff', '--no-renames',
    f.pricingPlan.runtimeSha, plan.runtimeSha]));
  assert.notEqual(abbreviated, plan.pricingToServingDiffSha256);
  for (const abbreviation of ['40', '7']) {
    f.git(['config', 'core.abbrev', abbreviation]);
    assert.deepEqual(f.servingPlan(), plan);
    const proof = await verifyServingCompatibility({...f, servingPlan: plan});
    assert.equal(proof.pricingToServingDiffSha256, plan.pricingToServingDiffSha256);
    assert.deepEqual(proof.pricingToServingFiles, plan.pricingToServingFiles);
    await assert.rejects(verifyServingCompatibility({...f,
      servingPlan: {...plan, pricingToServingDiffSha256: abbreviated}}), /china_serving_changed_bytes/);
    assert.equal(f.git(['ls-files', '--stage']), source);
    assert.equal(f.git(['status', '--porcelain']), '');
  }
});

test('changed serving bytes in the same files cannot reuse a reviewed canonical digest', async t => {
  const f = await fixture(t);
  f.git(['config', 'core.abbrev', '7']);
  await f.write('apps/web/lib/catalog/storage.ts', 'reviewed independent reader\n'); f.commit();
  const reviewed = f.servingPlan();
  await f.write('apps/web/lib/catalog/storage.ts', 'different committed reader\n'); f.commit();
  f.git(['config', 'core.abbrev', '40']);
  const changed = f.servingPlan();
  assert.deepEqual(changed.pricingToServingFiles, reviewed.pricingToServingFiles);
  assert.notEqual(changed.runtimeSha, reviewed.runtimeSha);
  assert.notEqual(changed.runtimeTree, reviewed.runtimeTree);
  assert.notEqual(changed.pricingToServingDiffSha256, reviewed.pricingToServingDiffSha256);
  await assert.rejects(verifyServingCompatibility({...f, servingPlan: {...changed,
    pricingToServingDiffSha256: reviewed.pricingToServingDiffSha256}}), /china_serving_changed_bytes/);
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


test('Japan usability admits its exact cumulative serving changes without widening accepted predecessors',async t=>{
 const f=await fixture(t),files=[...new Set([...JAPAN_RECOVERY_CODE_PATHS,...JAPAN_COMPLETION_V2_CODE_PATHS,...JAPAN_USABILITY_CODE_PATHS])].sort();
 for(const filename of files)await f.write(filename,'reviewed Japan catalog usability successor\n');
 f.commit();
 const proof=await verifyServingCompatibility({...f,servingPlan:{...f.servingPlan(),codeScope:'catalog-japan-usability-v1'}});
 assert.deepEqual(proof.pricingToServingFiles,files);assert.equal(proof.protectedPricingPathsUnchanged,true);
 for(const codeScope of ['catalog-japan-completion-v2','catalog-japan-completion-v1','catalog-japan-recovery-v1','catalog-photo-recovery-v1','catalog-photo-japan-power-v1'])
  await assert.rejects(verifyServingCompatibility({...f,servingPlan:{...f.servingPlan(),codeScope}}),/china_serving_change_scope/);
 await f.write('apps/web/lib/catalog/ajes-unreviewed-reader.ts','unreviewed adjacent change\n');f.commit();
 await assert.rejects(verifyServingCompatibility({...f,servingPlan:{...f.servingPlan(),codeScope:'catalog-japan-usability-v1'}}),/china_serving_change_scope/);
});

test('pagination24 cumulative compatibility starts at accepted a5ca without admitting b25 files',async t=>{
  const f=await fixture(t);
  for(const filename of [...new Set([...JAPAN_COMPLETION_V2_CODE_PATHS,...CRM_JAPAN_PHOTO_CODE_PATHS,...JAPAN_PAGINATION_CODE_PATHS])])
    await f.write(filename,'reviewed cumulative bytes\n');
  f.commit();
  const proof=await verifyServingCompatibility({...f,servingPlan:{...f.servingPlan(),codeScope:JAPAN_PAGINATION_CODE_SCOPE}});
  assert.equal(proof.protectedPricingPathsUnchanged,true);
  for(const codeScope of [CRM_CHINA_CODE_SCOPE,CRM_JAPAN_PHOTO_CODE_SCOPE,'catalog-japan-usability-v1','catalog-japan-completion-v2'])
    await assert.rejects(verifyServingCompatibility({...f,servingPlan:{...f.servingPlan(),codeScope}}),/china_serving_change_scope/);
  for(const filename of ['apps/web/lib/catalog/ajes-power-page.ts','apps/web/lib/catalog/japan-power-query.ts',
    'apps/web/lib/catalog/ajes-read-evidence.ts','apps/web/lib/catalog/japan-vehicle-policy.ts',
    'apps/web/lib/auth.ts','apps/web/app/(crm)/api/crm/team/route.ts','apps/web/lib/catalog/rates.ts']){
    await f.write(filename,'unreviewed bytes\n');f.commit();
    await assert.rejects(verifyServingCompatibility({...f,servingPlan:{...f.servingPlan(),codeScope:JAPAN_PAGINATION_CODE_SCOPE}}),/china_serving_change_scope/);
    f.git(['reset','--hard','HEAD~1']);
  }
});

test('Japan UI compatibility admits BrandLogoRail only with the exact reviewed successor',async t=>{
  const f=await fixture(t);
  const files=['apps/web/components/catalog/BrandLogoRail.tsx',
    'apps/web/components/catalog/CatalogCard.tsx','apps/web/components/catalog/CatalogContent.tsx'];
  for(const filename of files)await f.write(filename,'reviewed Japan source identity and preview provenance\n');
  f.commit();
  const plan=()=>({...f.servingPlan(),codeScope:JAPAN_STABILITY_CODE_SCOPE,
    retainedRuntime:JAPAN_STABILITY_RETAINED_RUNTIME,runtimeFiles:[...JAPAN_STABILITY_UI_CODE_PATHS]});
  const proof=await verifyServingCompatibility({...f,servingPlan:plan()});
  assert.deepEqual(proof.pricingToServingFiles,files);
  assert.equal(proof.protectedPricingPathsUnchanged,true);
  await assert.rejects(verifyServingCompatibility({...f,servingPlan:{...plan(),
    runtimeFiles:[...JAPAN_STABILITY_CODE_PATHS]}}),/china_serving_change_scope/);
  for(const codeScope of [CRM_JAPAN_PHOTO_CODE_SCOPE,JAPAN_PAGINATION_CODE_SCOPE])
    await assert.rejects(verifyServingCompatibility({...f,servingPlan:{...plan(),codeScope}}),/china_serving_change_scope/);
  for(const runtimeFiles of [JAPAN_STABILITY_UI_CODE_PATHS.slice(1),
    [...JAPAN_STABILITY_UI_CODE_PATHS,files[0]],
    [...JAPAN_STABILITY_UI_CODE_PATHS,'apps/web/components/catalog/Unreviewed.tsx']])
    await assert.rejects(verifyServingCompatibility({...f,servingPlan:{...plan(),runtimeFiles}}),/china_serving_stability_scope/);
  for(const filename of ['apps/web/lib/catalog/ajes-power-page.ts','apps/web/lib/catalog/rates.ts',
    'apps/web/lib/encyclopedia/calculation-index.ts','apps/web/components/catalog/Unreviewed.tsx']){
    await f.write(filename,'unreviewed adjacent or protected bytes\n');f.commit();
    await assert.rejects(verifyServingCompatibility({...f,servingPlan:plan()}),/china_serving_change_scope/);
    f.git(['reset','--hard','HEAD~1']);
  }
});
