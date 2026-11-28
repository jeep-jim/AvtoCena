import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {verifyChinaImageRuntime} from '../scripts/catalog-next/build-release-image.mjs';
import {readChinaDailyPlans,selectChinaDailyServingPlan} from '../scripts/catalog-next/daily-entry.mjs';
import {JAPAN_PAGINATION_CODE_SCOPE, JAPAN_PAGINATION_RETAINED_RUNTIME,
  JAPAN_PAGINATION_CODE_PATHS, isExactJapanPaginationScope}
  from '../scripts/catalog-next/japan-pagination-code-scope.mjs';
import {checkedCatalogCodeScope} from '../scripts/catalog-next/photo-code-scope.mjs';
import {JAPAN_STABILITY_CODE_SCOPE, JAPAN_STABILITY_EXACT_COUNT_RETAINED_RUNTIME,
  JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS, JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY,
  JAPAN_SOURCE_COUNT_POLICY, JAPAN_STABILITY_SOURCE_COUNT_RETAINED_RUNTIME,
  JAPAN_STABILITY_SOURCE_COUNT_CODE_PATHS, JAPAN_STABILITY_MODEL_CURSOR_RETAINED_RUNTIME,
  JAPAN_STABILITY_MODEL_CURSOR_CODE_PATHS, JAPAN_STABILITY_SOURCE_PRICE_ORDER_RETAINED_RUNTIME,
  JAPAN_STABILITY_SOURCE_PRICE_ORDER_CODE_PATHS, japanSourcePriceOrderRequired,
  isExactJapanStabilityScope, japanPriceSortRequired, japanExactCountRequired,
  japanSourceBoundedIncrementalRequired, japanSourceCountRequired,
  japanLiteralFamilyRequired, japanA4Power160ContinuationRequired} from '../scripts/catalog-next/japan-stability-code-scope.mjs';

const plan = () => ({codeScope:JAPAN_PAGINATION_CODE_SCOPE,
  retainedRuntime:JAPAN_PAGINATION_RETAINED_RUNTIME, runtimeFiles:[...JAPAN_PAGINATION_CODE_PATHS]});

test('pagination24 pins accepted a5ca and exactly the eleven reviewed runtime paths', () => {
  assert.equal(JAPAN_PAGINATION_CODE_SCOPE, 'catalog-japan-pagination24-v1');
  assert.equal(JAPAN_PAGINATION_RETAINED_RUNTIME, 'a5ca426eec2663eb17c2df69fe2bfed46e2b8740');
  assert.equal(JAPAN_PAGINATION_CODE_PATHS.length, 11);
  assert(Object.isFrozen(JAPAN_PAGINATION_CODE_PATHS));
  assert.equal(new Set(JAPAN_PAGINATION_CODE_PATHS).size, 11);
  assert(isExactJapanPaginationScope(plan()));
  assert.equal(checkedCatalogCodeScope(plan()), JAPAN_PAGINATION_CODE_SCOPE);
  assert(isExactJapanPaginationScope({...plan(), runtimeFiles:[...JAPAN_PAGINATION_CODE_PATHS].reverse()}));
});

test('missing, extra, duplicate, foreign scope and wrong accepted ancestor cannot enable pagination24', () => {
  const variants = [
    {...plan(),runtimeFiles:JAPAN_PAGINATION_CODE_PATHS.slice(1)},
    {...plan(),runtimeFiles:[...JAPAN_PAGINATION_CODE_PATHS,'tests/unreviewed.test.ts']},
    {...plan(),runtimeFiles:[JAPAN_PAGINATION_CODE_PATHS[0],...JAPAN_PAGINATION_CODE_PATHS.slice(0,-1)]},
    {...plan(),codeScope:'catalog-japan-usability-v1'},
    {...plan(),retainedRuntime:'077cbb17626ab0c64e7f06db055fef9252ad21c0'},
    {...plan(),retainedRuntime:'b25a95122199378afc5166ed7ac8882a84ed9fe3'},
  ];
  for (const value of variants) {
    assert.equal(isExactJapanPaginationScope(value), false);
    assert.throws(() => checkedCatalogCodeScope(value));
  }
});

test('pagination24 cannot authorize source SQL, transport, pricing, CRM or rejected usability paths', () => {
  for (const name of ['apps/web/lib/catalog/ajes-query.ts','apps/web/lib/catalog/ajes-client.ts',
    'apps/web/lib/catalog/ajes-public.ts','apps/web/lib/catalog/japan-power-query.ts',
    'apps/web/lib/catalog/ajes-power-page.ts','apps/web/lib/catalog/japan-vehicle-policy.ts',
    'apps/web/lib/catalog/ajes-read-evidence.ts','apps/web/lib/catalog/live-business-pricing.ts',
    'apps/web/app/(crm)/api/crm/china-catalog-status/route.ts','apps/web/components/site/CollectionControls.tsx']) {
    const value={...plan(),runtimeFiles:[name,...JAPAN_PAGINATION_CODE_PATHS.slice(1)]};
    assert.equal(isExactJapanPaginationScope(value),false,name);
    assert.throws(() => checkedCatalogCodeScope(value));
  }
});

test('existing scopes keep their separate file sets and reject the new pagination delta', () => {
  for (const codeScope of ['catalog-photo-recovery-v1','catalog-photo-japan-power-v1',
    'catalog-japan-recovery-v1','catalog-japan-completion-v1','catalog-japan-completion-v2',
    'catalog-japan-usability-v1','catalog-crm-china-operations-v1','catalog-crm-japan-photo-retry-v1'])
    assert.throws(() => checkedCatalogCodeScope({...plan(),codeScope}),codeScope);
});

test('pagination image verification keeps every CRM path protected and grants no exception',async()=>{
  const root=await fs.realpath(os.tmpdir()),bytes=Buffer.from('synthetic bounded refill delta');
  const full={...plan(),version:1,market:'china',runtimeSha:'2'.repeat(40),runtimeTree:'3'.repeat(40),
    runtimeDiffSha256:createHash('sha256').update(bytes).digest('hex')};
  let protectedChecks=0;
  const execute=async(command,args)=>{
    assert.equal(command,'/usr/bin/git');assert.equal(args[0],'--no-optional-locks');
    const sub=args.slice(1);
    if(sub[0]==='rev-parse')return Buffer.from(sub[1]==='--show-toplevel'?root:sub[1]==='HEAD'?full.runtimeSha:full.runtimeTree);
    if(sub[0]==='merge-base'){assert.deepEqual(sub,['merge-base','--is-ancestor',JAPAN_PAGINATION_RETAINED_RUNTIME,full.runtimeSha]);return Buffer.alloc(0);}
    assert.equal(sub[0],'diff');
    if(sub.includes('--name-only'))return Buffer.from([...JAPAN_PAGINATION_CODE_PATHS].sort().join('\0')+'\0');
    if(sub.includes('--binary'))return bytes;
    assert.equal(sub[1],'--quiet');
    if(sub.includes('packages/engine')){
      protectedChecks++;assert.ok(sub.includes('apps/web/app/(crm)'));assert.ok(sub.includes('apps/web/components/site'));
      assert.ok(!sub.some(value=>value.startsWith(':(exclude')));
    }
    return Buffer.alloc(0);
  };
  const proof=await verifyChinaImageRuntime({runtimeRoot:root,plan:full,execute});
  assert.equal(proof.protectedPathsUnchanged,true);assert.equal(protectedChecks,1);
  assert.equal(Object.hasOwn(proof,'protectedPathExceptions'),false);
  await assert.rejects(verifyChinaImageRuntime({runtimeRoot:root,plan:{...full,retainedRuntime:'0'.repeat(40)},
    execute:()=>assert.fail('wrong predecessor must fail before git')}),/china_image_pagination_scope/);
});

test('review plans retain accepted5b1 until the reviewed source-order and count successor is accepted',async()=>{
  const plans=await readChinaDailyPlans(),base=plans.servingPlan;
  assert.equal(base.runtimeSha,JAPAN_STABILITY_SOURCE_PRICE_ORDER_RETAINED_RUNTIME);
  assert.equal(base.retainedRuntime,JAPAN_STABILITY_MODEL_CURSOR_RETAINED_RUNTIME);
  assert.equal(base.runtimeTree,'ac4c70c441c161e22599c27f45dd60cce9dd117b');
  assert.equal(base.runtimeFiles.length,5);
  assert.deepEqual([...base.runtimeFiles].sort(),[...JAPAN_STABILITY_MODEL_CURSOR_CODE_PATHS].sort());
  assert.equal(base.codeScope,JAPAN_STABILITY_CODE_SCOPE);
  assert.equal(isExactJapanStabilityScope(base),true);
  assert.equal(base.countAcceptance,JAPAN_SOURCE_COUNT_POLICY);
  assert.equal(japanPriceSortRequired(base),true);
  assert.equal(japanExactCountRequired(base),false);
  assert.equal(japanSourceBoundedIncrementalRequired(base),false);
  assert.equal(japanSourceCountRequired(base),true);
  assert.equal(japanA4Power160ContinuationRequired(base),true);
  assert.equal(japanSourcePriceOrderRequired(base),false);
  assert.equal(japanLiteralFamilyRequired(base),true);
  assert.equal(japanExactCountRequired({...base,retainedRuntime:JAPAN_STABILITY_EXACT_COUNT_RETAINED_RUNTIME,
    runtimeFiles:[...JAPAN_STABILITY_EXACT_COUNT_CODE_PATHS],countAcceptance:undefined}),true);
  assert.equal(base.runtimeDiffSha256,'e1da31f4c7070154f25345be61bd366ecdacd426eb7873aa4a4fddd5f543c5be');
  assert.equal(base.pricingToServingDiffSha256,'5728ee0506775dc4f0d828828cae59837be164592bde27898ed3424a29024b95');
  assert.equal(base.pricingToServingFiles.length,133);
  assert.equal(selectChinaDailyServingPlan(plans,base.runtimeSha),base);
  const successors=plans.servingPlans.filter(value=>value!==base);
  assert.equal(successors.length,1);
  const successor=successors[0];
  assert.equal(successor.retainedRuntime,base.runtimeSha);
  assert.equal(successor.runtimeSha,'21d1ad901dff0e51c904dc7dee22dfd534550d18');
  assert.equal(successor.runtimeTree,'7d57f7dc77fbd44d9bece1ef31c393b160bf0c10');
  assert.equal(successor.runtimeFiles.length,27);
  assert.deepEqual([...successor.runtimeFiles].sort(),[...JAPAN_STABILITY_SOURCE_PRICE_ORDER_CODE_PATHS].sort());
  assert.equal(successor.codeScope,JAPAN_STABILITY_CODE_SCOPE);
  assert.equal(isExactJapanStabilityScope(successor),true);
  assert.equal(successor.countAcceptance,JAPAN_SOURCE_COUNT_POLICY);
  assert.equal(japanPriceSortRequired(successor),true);
  assert.equal(japanExactCountRequired(successor),false);
  assert.equal(japanSourceBoundedIncrementalRequired(successor),false);
  assert.equal(japanSourceCountRequired(successor),true);
  assert.equal(japanA4Power160ContinuationRequired(successor),true);
  assert.equal(japanSourcePriceOrderRequired(successor),true);
  assert.equal(japanLiteralFamilyRequired(successor),true);
  assert.equal(successor.runtimeDiffSha256,'b7ecf8e73bf6ec0e71f034d02d992fda53186d24331e635aa5f0ea24f406c23e');
  assert.equal(successor.pricingToServingDiffSha256,'7246193aea2ba4d2cd90ec189de9e0adaba2ba205b36aee24a71b3e4d29cb523');
  assert.equal(successor.pricingToServingFiles.length,140);
  for(const countAcceptance of [undefined,JAPAN_SOURCE_BOUNDED_INCREMENTAL_POLICY]){
    const invalid={...successor,countAcceptance};
    assert.equal(isExactJapanStabilityScope(invalid),false);
    assert.throws(()=>checkedCatalogCodeScope(invalid));
    assert.throws(()=>japanExactCountRequired(invalid),/japan_stability_exact_count_scope/);
  }
  assert.equal(selectChinaDailyServingPlan(plans,successor.runtimeSha),successor);
  assert.deepEqual(successor.source,base.source);assert.deepEqual(successor.encyclopedia,base.encyclopedia);
  assert.equal(successor.pricingRuntimeSha,base.pricingRuntimeSha);
  assert.equal(successor.pricingRuntimeTree,base.pricingRuntimeTree);
  assert.throws(()=>selectChinaDailyServingPlan(plans,'b25a95122199378afc5166ed7ac8882a84ed9fe3'),/accepted_runtime/);
});
