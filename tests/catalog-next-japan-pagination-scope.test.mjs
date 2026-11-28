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
import {JAPAN_STABILITY_CODE_SCOPE, JAPAN_STABILITY_PRICE_SORT_RETAINED_RUNTIME,
  JAPAN_STABILITY_EXACT_COUNT_RETAINED_RUNTIME,
  isExactJapanStabilityScope, japanPriceSortRequired, japanExactCountRequired,
  japanSourceBoundedIncrementalRequired, japanLiteralFamilyRequired} from '../scripts/catalog-next/japan-stability-code-scope.mjs';

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

test('review plans keep accepted20fd selectable until the explicit source-model successor is accepted',async()=>{
  const plans=await readChinaDailyPlans(),base=plans.servingPlan;
  assert.equal(base.runtimeSha,JAPAN_STABILITY_EXACT_COUNT_RETAINED_RUNTIME);
  assert.equal(base.retainedRuntime,JAPAN_STABILITY_PRICE_SORT_RETAINED_RUNTIME);
  assert.equal(base.runtimeTree,'b3257c801b2b26cc84ec8d37380a2d8ec120b431');
  assert.equal(base.codeScope,JAPAN_STABILITY_CODE_SCOPE);
  assert.equal(isExactJapanStabilityScope(base),true);
  assert.equal(japanPriceSortRequired(base),true);
  assert.equal(japanExactCountRequired(base),false);
  assert.equal(base.runtimeDiffSha256,'8e5a3d15adeec0f78c073e982f30fe1a2278b1e6462d2ec81dad13ac12280515');
  assert.equal(base.pricingToServingDiffSha256,'9b38b084da8e0396811d32394aefd52894ba07e896f349daab5615a9e33c27a0');
  assert.equal(selectChinaDailyServingPlan(plans,base.runtimeSha),base);
  const successors=plans.servingPlans.filter(value=>value!==base);
  assert.equal(successors.length,1);
  const successor=successors[0];
  assert.equal(successor.retainedRuntime,base.runtimeSha);
  assert.equal(isExactJapanStabilityScope(successor),true);
  assert.equal(japanPriceSortRequired(successor),true);
  assert.equal(japanExactCountRequired(successor),false);
  assert.equal(japanSourceBoundedIncrementalRequired(successor),true);
  assert.equal(japanLiteralFamilyRequired(successor),true);
  assert.equal(japanExactCountRequired({...successor,countAcceptance:undefined}),true);
  assert.equal(selectChinaDailyServingPlan(plans,successor.runtimeSha),successor);
  assert.deepEqual(successor.source,base.source);assert.deepEqual(successor.encyclopedia,base.encyclopedia);
  assert.equal(successor.pricingRuntimeSha,base.pricingRuntimeSha);
  assert.equal(successor.pricingRuntimeTree,base.pricingRuntimeTree);
  assert.throws(()=>selectChinaDailyServingPlan(plans,'b25a95122199378afc5166ed7ac8882a84ed9fe3'),/accepted_runtime/);
});
