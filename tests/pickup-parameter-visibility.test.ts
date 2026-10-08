import test from 'node:test';
import assert from 'node:assert/strict';
import {commercialParameters} from '../apps/web/lib/catalog/commercial-parameters';
import {offerParameterDraft} from '../apps/web/lib/catalog/offer-parameter-draft';

test('pickup names used by customs also expose category and mass when body is missing', () => {
  for (const model of ['Hilux','Gladiator','Colorado','Frontier','Triton','Rexton Sports Khan','Silverado','F-150','RAM 1500','Cannon']) {
    const result = commercialParameters({model});
    assert.equal(result.showCommercial, true, model);
    assert.equal(result.vehicleCategory, '', 'model alone must not certify N1');
  }
  assert.equal(commercialParameters({model:'Rexton',sourceTitle:'SsangYong Rexton Sports Khan'}).showCommercial,true);
  assert.equal(commercialParameters({model:'Corolla',bodyType:'sedan'}).showCommercial,false);
});
test('pickup body aliases expose the existing N1 scenario without guessing mass', () => {
  for (const bodyType of ['pickup','Pick up','pick-up','Пикап','皮卡','픽업']) {
    const draft=offerParameterDraft({bodyType} as any);
    assert.equal(draft.vehicleCategory,'N1');
    assert.equal(draft.grossVehicleWeightKg,'');
  }
});
test('documented passenger pickup and conflicting evidence are not overwritten', () => {
  for (const data of [{vehicleCategory:'M1'},{tnVedCode:'8703'}]) {
    assert.equal(offerParameterDraft({bodyType:'pickup',...data} as any).vehicleCategory,'M1');
  }
  assert.equal(commercialParameters({bodyType:'pickup',operational:{semanticEvidence:{vehicleCategory:{status:'conflict'}}}} as any).vehicleCategory,'');
  const conflict=commercialParameters({bodyType:'pickup',vehicleCategory:'M1',tnVedCode:'8704'});
  assert.equal(conflict.vehicleCategory,'M1');
  assert.equal(conflict.showCommercial,true);
});
