import {HOME_UI, verifyHomeSourceCheckout, assertHomeSourceEvidence, sha256} from './contract.mjs';

const need = (value, code) => { if (!value) throw Error('home_ui_binding_' + code); };
const bindingKey = release => 'knowledge/encyclopedia/calculation-releases/' + release + '.json';
const indexKey = 'knowledge/encyclopedia/calculation-indexes/' + HOME_UI.privateIndexDigest + '.json';
const target = Object.freeze({version:1, release:HOME_UI.source, digest:HOME_UI.privateIndexDigest, key:indexKey});
const sameBinding = (value, release) => value?.version === 1 && value.release === release
  && value.digest === HOME_UI.privateIndexDigest && value.key === indexKey;

export function assertHomeBindingInputs({sourceProof, live, retainedBinding, targetBinding, index}) {
  assertHomeSourceEvidence(sourceProof);
  need(live?.release === HOME_UI.retainedSource && live.calculationVersion === HOME_UI.servingCalculationVersion, 'retained_live_identity');
  need(sameBinding(retainedBinding, HOME_UI.retainedSource) || sameBinding(retainedBinding, HOME_UI.privateIndexParent), 'retained_binding');
  need(index?.version === 1 && index.digest === HOME_UI.privateIndexDigest && index.models
    && sha256(JSON.stringify(index.models)) === HOME_UI.privateIndexDigest, 'immutable_index');
  need(targetBinding === null || sameBinding(targetBinding, HOME_UI.source), 'existing_target_changed');
  const intent = {version:1, operation:'bind-exact-home-ui-private-index', sourceProof,
    retainedSource:HOME_UI.retainedSource, retainedBindingSource:retainedBinding.release,
    servingCalculationVersion:HOME_UI.servingCalculationVersion, bindingKey:bindingKey(HOME_UI.source), binding:target};
  return {...intent, planSha256:sha256(JSON.stringify(intent)), targetAlreadyPresent:targetBinding !== null};
}

// Preparation is GET-only. The source checkout must be the exact clean catalog-b4d2
// tree; callers cannot supply a convenient replacement release or digest.
export async function prepareHomeBindingPlan({storage, sourceRoot, readLiveIdentity}) {
  need(storage?.driver === 'object' && typeof readLiveIdentity === 'function', 'context');
  const sourceProof = verifyHomeSourceCheckout(sourceRoot), live = await readLiveIdentity();
  let retainedBinding = await storage.readJson(bindingKey(HOME_UI.retainedSource), null);
  if (retainedBinding === null) retainedBinding = await storage.readJson(bindingKey(HOME_UI.privateIndexParent), null);
  const index = await storage.readJson(indexKey, null);
  const targetBinding = await storage.readJson(bindingKey(HOME_UI.source), null);
  return assertHomeBindingInputs({sourceProof, live, retainedBinding, targetBinding, index});
}

// No CLI or workflow calls this writer. A future exact controller must supply
// the reviewed plan hash and re-prove live identity, source and immutable data.
// Its only possible write is a conditional creation of catalog-b4d2's binding.
export async function applyReviewedHomeBinding(options) {
  need(/^[a-f0-9]{64}$/.test(options.reviewedPlanSha256 || ''), 'reviewed_plan_missing');
  const plan = await prepareHomeBindingPlan(options);
  need(plan.planSha256 === options.reviewedPlanSha256, 'reviewed_plan_changed');
  let written = false;
  if (!plan.targetAlreadyPresent) {
    const live = await options.readLiveIdentity();
    need(live?.release === HOME_UI.retainedSource && live.calculationVersion === HOME_UI.servingCalculationVersion, 'prewrite_live_changed');
    await options.storage.writeJson(plan.bindingKey, plan.binding, {ifNoneMatch:'*'});
    written = true;
  }
  need(sameBinding(await options.storage.readJson(plan.bindingKey, null), HOME_UI.source), 'readback_failed');
  return {version:1, release:HOME_UI.source, indexDigest:HOME_UI.privateIndexDigest,
    planSha256:plan.planSha256, created:written, readbackVerified:true};
}
