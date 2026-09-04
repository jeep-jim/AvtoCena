import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendRoadmapCheckpoint,
  classifyRegistry,
  evidenceText,
  useScope,
} from '../scripts/catalog-source-beforward-japan-classify-v1.mjs';

test('BE FORWARD classifier promotes only research_pending to lead_only and keeps publication closed', () => {
  const registry = {
    updatedAt: '2026-09-03',
    candidates: [
      { sourceId: 'beforward_japan_candidate', class: 'research_pending', publishAllowed: false, evidence: 'old' },
      { sourceId: 'sbtjapan_japan_candidate', class: 'research_pending', publishAllowed: false, evidence: 'untouched' },
    ],
    next: 'old next',
  };
  const out = classifyRegistry(structuredClone(registry));
  const row = out.candidates[0];
  assert.equal(row.class, 'lead_only');
  assert.equal(row.publishAllowed, false);
  assert.equal(row.evidence, evidenceText);
  assert.equal(row.useScope, useScope);
  assert.equal(row.qualificationDecision, 'docs/catalog-source-beforward-japan-qualification-v1.md');
  assert.equal(out.updatedAt, '2026-09-04');
  assert.match(out.next, /sbtjapan_japan_candidate/);
  assert.deepEqual(out.candidates[1], registry.candidates[1]);
});

test('BE FORWARD classifier is idempotent for already lead_only row', () => {
  const registry = { candidates: [{ sourceId: 'beforward_japan_candidate', class: 'lead_only', publishAllowed: false }] };
  const first = classifyRegistry(structuredClone(registry));
  const second = classifyRegistry(structuredClone(first));
  assert.deepEqual(second, first);
});

test('BE FORWARD classifier refuses any open publication state', () => {
  assert.throws(() => classifyRegistry({ candidates: [{ sourceId: 'beforward_japan_candidate', class: 'research_pending', publishAllowed: true }] }), /publishAllowed must remain false/);
});

test('roadmap checkpoint is append-only, idempotent and leaves exactly one EOF newline', () => {
  const before = '# Roadmap\n\n### 40.29. Previous\n- preserved\n';
  const after = appendRoadmapCheckpoint(before);
  assert.ok(after.startsWith(before.trimEnd()));
  assert.match(after, /### 40\.30\. BE FORWARD Japan:/);
  assert.match(after, /33834734630/);
  assert.equal(after.endsWith('\n'), true);
  assert.equal(after.endsWith('\n\n'), false);
  assert.equal(appendRoadmapCheckpoint(after), after);
});
