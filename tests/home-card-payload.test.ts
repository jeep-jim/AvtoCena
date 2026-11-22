import test from 'node:test';
import assert from 'node:assert/strict';
import {homeCardPayload} from '../apps/web/app/_lib/home-card-payload';
import {classifySpecificationEvidence, SPECIFICATION_AUDIT_FIELDS} from '../apps/web/lib/catalog/specification-evidence-audit';

test('home cards preserve pricing, selection and resolved evidence without serializing its bibliography', () => {
  const fact = {status:'exact', value:150, source:'encyclopedia', provenance:[{revision:'rev1'}]};
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

test('evidence states used by card calculation survive payload serialization', () => {
  for (const status of ['exact', 'verified', 'ambiguous', 'conflict', 'missing']) {
    const row = {
      id:'test-offer', make:'Toyota', model:'Corolla', year:2023, engineCc:1800,
      powerHp:140, fuel:'petrol', powertrainKind:'combustion' as const,
      operational:{semanticEvidence:Object.fromEntries(['powerHp', 'engineCc', 'fuel', 'powertrainKind'].map(key=>[
        key, {status, provenance:[{source:'private-reference', revision:'rev1'}]},
      ]))},
    };
    const original = SPECIFICATION_AUDIT_FIELDS.map(field=>classifySpecificationEvidence(row, field));
    const payload = JSON.parse(JSON.stringify(homeCardPayload(row)));
    assert.deepEqual(SPECIFICATION_AUDIT_FIELDS.map(field=>classifySpecificationEvidence(payload, field)), original);
    assert.equal(JSON.stringify(payload).includes('private-reference'), false);
    assert.equal(JSON.stringify(row).includes('private-reference'), true);
  }
});
