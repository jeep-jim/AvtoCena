import test from 'node:test';
import assert from 'node:assert/strict';
import {homeCardPayload} from '../apps/web/lib/catalog/home-card-payload';

test('home cards keep pricing, selection and resolved evidence without serializing its bibliography', () => {
  const fact = { status:'exact', value:150, source:'encyclopedia', provenance:[{revision:'rev1'}] };
  const other = {status:'conflict', value:null};
  const operational = {semanticEvidence:{powerHp:fact, fuel:other}, managementKnowledge:{parameters:{}}};
  const row = {id:'car', totalRub:1234567, preparedChinaSelection:{generationId:'g'}, operational};
  const expected = {...row, operational:{...operational, semanticEvidence:{
    powerHp:{status:'exact', value:150, source:'encyclopedia'}, fuel:other,
  }}};
  assert.deepEqual(homeCardPayload(row), expected);
  assert.equal(row.operational.semanticEvidence.powerHp.provenance.length, 1);
  assert.equal(homeCardPayload(expected), expected);
  const older = {id:'old'};
  assert.equal(homeCardPayload(older), older);
});
