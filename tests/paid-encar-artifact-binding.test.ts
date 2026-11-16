import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validatePaidEncarArtifactBinding, assertPaidEncarArtifactBinding,
  assertPaidEncarReportBinding, assertPaidEncarArchiveDigest} from '../scripts/lib/paid-encar-artifact-binding.mjs';

const completedAt = '2026-11-16T08:00:00Z', now = Date.parse(completedAt);
const context = () => ({runId: '43812759975', currentAttempt: '2', snapshotAttempt: '1',
  artifactId: '14178273080', artifactDigest: 'a'.repeat(64), repositoryId: '1072507081',
  headSha: '83ff17075e9188dcf227c8752dc064248d5f42e0'});
const metadata = (binding = context()) => ({id: Number(binding.artifactId),
  name: `catalog-intake-korea-${binding.runId}-${binding.snapshotAttempt}`,
  size_in_bytes: 123456, expired: false, digest: `sha256:${binding.artifactDigest}`,
  workflow_run: {id: Number(binding.runId), repository_id: Number(binding.repositoryId),
    head_repository_id: Number(binding.repositoryId), head_sha: binding.headSha, head_branch: 'main'}});
const report = (binding = context()) => ({version: 1, market: 'korea', provider: 'auto_api_encar',
  completed: true, completedAt, snapshotRun: binding.runId,
  snapshotAttempt: binding.snapshotAttempt, requiredSourceIds: ['encar_direct'], confirmedWithdrawals: [],
  sources: [{sourceId: 'encar_direct', provider: 'auto_api_encar', observations: 12,
    uniqueOffers: 12, stopReason: 'source_finished', syncMode: 'snapshot', pages: 1, excluded: 0}]});

test('same-run artifact metadata and restored paid report bind to the caller context', () => {
  const expected = context();
  const checked = validatePaidEncarArtifactBinding(expected, {preparedRunId: expected.runId});
  assert.deepEqual(checked, expected); assert.equal(Object.isFrozen(checked), true);
  assert.deepEqual(assertPaidEncarArtifactBinding(checked, metadata(checked)), checked);
  assert.deepEqual(assertPaidEncarReportBinding(checked, report(checked), {now}), checked);
  expected.headSha = 'f'.repeat(40);
  assert.notEqual(checked.headSha, expected.headSha, 'the validated context is an independent immutable copy');
});

test('publisher-only reruns may use an earlier successful producer attempt, never a future attempt', () => {
  for (const snapshotAttempt of ['1', '2']) {
    const binding = {...context(), snapshotAttempt};
    assertPaidEncarArtifactBinding(binding, metadata(binding));
    assertPaidEncarReportBinding(binding, report(binding), {now});
  }
  assert.throws(() => validatePaidEncarArtifactBinding({...context(), snapshotAttempt: '3'}), /future_attempt/);
  assert.throws(() => validatePaidEncarArtifactBinding({...context(), currentAttempt: '9', snapshotAttempt: '10'}), /future_attempt/);
  const large = {...context(), currentAttempt: '9007199254740993', snapshotAttempt: '9007199254740992'};
  assert.deepEqual(validatePaidEncarArtifactBinding(large), large, 'attempt ordering must not round decimal identities');
  assert.throws(() => validatePaidEncarArtifactBinding({...large, snapshotAttempt: '9007199254740994'}), /future_attempt/);
});

test('context identities must be positive canonical integer strings with exact SHA and digest syntax', () => {
  for (const field of ['runId', 'currentAttempt', 'snapshotAttempt', 'artifactId', 'repositoryId']) {
    for (const value of [1, 0, '0', '01', '-1', '+1', '1.0', '1e3', ' 1', '1 ', '', null, undefined]) {
      assert.throws(() => validatePaidEncarArtifactBinding({...context(), [field]: value}), /paid_encar_artifact_binding_/);
    }
  }
  for (const field of ['headSha', 'artifactDigest']) {
    for (const value of ['', 'A'.repeat(field === 'headSha' ? 40 : 64), context()[field].slice(1), 'sha256:' + context()[field], null]) {
      assert.throws(() => validatePaidEncarArtifactBinding({...context(), [field]: value}), /paid_encar_artifact_binding_/);
    }
  }
  for (const value of [null, [], {}, {...context(), extra: 'not bound'}]) {
    assert.throws(() => validatePaidEncarArtifactBinding(value), /paid_encar_artifact_binding_context/);
  }
});

test('an explicitly supplied prepared run must be the caller run, not another successful run', () => {
  const binding = context();
  for (const preparedRunId of ['43812759976', '043812759975', Number(binding.runId), '']) {
    assert.throws(() => validatePaidEncarArtifactBinding(binding, {preparedRunId}), /prepared_run/);
  }
});

const alteredMetadata = [
  ['artifact ID', value => {value.id++;}],
  ['workflow run ID', value => {value.workflow_run.id++;}],
  ['repository ID', value => {value.workflow_run.repository_id++;}],
  ['head repository ID', value => {value.workflow_run.head_repository_id++;}],
  ['head SHA', value => {value.workflow_run.head_sha = 'b'.repeat(40);}],
  ['head branch', value => {value.workflow_run.head_branch = 'feature/other';}],
  ['artifact name', value => {value.name = 'catalog-intake-korea';}],
  ['artifact attempt', value => {value.name = `catalog-intake-korea-${context().runId}-2`;}],
  ['artifact digest', value => {value.digest = 'sha256:' + 'b'.repeat(64);}],
  ['digest encoding', value => {value.digest = context().artifactDigest;}],
  ['expired artifact', value => {value.expired = true;}],
  ['nonboolean expiration', value => {value.expired = 'false';}],
  ['unsafe numeric artifact ID', value => {value.id = Number.MAX_SAFE_INTEGER + 1;}],
  ['noncanonical metadata ID', value => {value.workflow_run.id = '0' + context().runId;}],
];
for (const [label, alter] of alteredMetadata) test(`artifact binding rejects ${label}`, () => {
  const value = metadata(); alter(value);
  assert.throws(() => assertPaidEncarArtifactBinding(context(), value), /paid_encar_artifact_binding_/);
});

test('every identity field in GitHub artifact metadata is required', () => {
  for (const field of ['id', 'name', 'expired', 'digest', 'workflow_run']) {
    const value = metadata(); delete value[field];
    assert.throws(() => assertPaidEncarArtifactBinding(context(), value), /paid_encar_artifact_binding_/);
  }
  for (const field of ['id', 'repository_id', 'head_repository_id', 'head_sha', 'head_branch']) {
    const value = metadata(); delete value.workflow_run[field];
    assert.throws(() => assertPaidEncarArtifactBinding(context(), value), /paid_encar_artifact_binding_/);
  }
  for (const value of [null, [], {workflow_run: {}}]) {
    assert.throws(() => assertPaidEncarArtifactBinding(context(), value), /paid_encar_artifact_binding_/);
  }
});

test('canonical textual metadata IDs compare exactly without permissive numeric coercion', () => {
  const binding = context(), value = metadata(binding);
  value.id = binding.artifactId; value.workflow_run.id = binding.runId;
  value.workflow_run.repository_id = binding.repositoryId; value.workflow_run.head_repository_id = binding.repositoryId;
  assertPaidEncarArtifactBinding(binding, value);
});

test('report must identify the bound producer attempt even during a later publisher attempt', () => {
  for (const change of [
    {snapshotRun: '43812759976'}, {snapshotRun: Number(context().runId)},
    {snapshotAttempt: context().currentAttempt}, {snapshotAttempt: 1}, {snapshotAttempt: undefined},
  ]) {
    assert.throws(() => assertPaidEncarReportBinding(context(), {...report(), ...change}, {now}), /paid_encar_report_binding_snapshot_/);
  }
});

test('a bound report must remain a completed nonempty single-source paid Korea snapshot', () => {
  const invalid = [null, [], {...report(), completed: false}, {...report(), completed: 1},
    {...report(), market: 'china'}, {...report(), provider: 'parser'}, {...report(), sources: []},
    {...report(), sources: [report().sources[0], report().sources[0]]},
    ...[{sourceId: 'kcar_korea_open'}, {stopReason: 'time_budget'}, {uniqueOffers: 0},
      {uniqueOffers: 1.5}, {uniqueOffers: Number.MAX_SAFE_INTEGER + 1}].map(change =>
      ({...report(), sources: [{...report().sources[0], ...change}]})),
  ];
  for (const value of invalid) {
    assert.throws(() => assertPaidEncarReportBinding(context(), value, {now}), /paid_encar_report_binding_/);
  }
});

test('artifact and report assertions reject invalid contexts independently', () => {
  const invalid = {...context(), snapshotAttempt: '3'};
  assert.throws(() => assertPaidEncarArtifactBinding(invalid, metadata(invalid)), /future_attempt/);
  assert.throws(() => assertPaidEncarReportBinding(invalid, report(invalid), {now}), /future_attempt/);
});

test('a publisher-only retry cannot use a future, invalid or more-than-three-day-old snapshot', () => {
  const lifetime = 3 * 86400000;
  for (const time of [now, now + lifetime]) {
    assertPaidEncarReportBinding(context(), report(), {now: time});
  }
  for (const time of [now - 1, now + lifetime + 1]) {
    assert.throws(() => assertPaidEncarReportBinding(context(), report(), {now: time}), /paid_encar_report_binding_stale/);
  }
  for (const completedAt of [undefined, 'invalid']) {
    assert.throws(() => assertPaidEncarReportBinding(context(), {...report(), completedAt}, {now}), /paid_encar_report_binding_stale/);
  }
});

test('archive bytes must match the bound upload digest before extraction', async () => {
  const archive = Buffer.from('completed paid Korea artifact');
  const binding = {...context(), artifactDigest: createHash('sha256').update(archive).digest('hex')};
  assert.deepEqual(await assertPaidEncarArchiveDigest(binding, [archive]), binding);
  assert.deepEqual(await assertPaidEncarArchiveDigest(binding, [archive.subarray(0, 7), archive.subarray(7)]), binding);
  const changed = Buffer.from(archive); changed[0] ^= 1;
  await assert.rejects(assertPaidEncarArchiveDigest(binding, [changed]), /archive_digest/);
  await assert.rejects(assertPaidEncarArchiveDigest(binding, []), /archive_digest/);
  await assert.rejects(assertPaidEncarArchiveDigest(binding, [archive.toString()]), /archive_bytes/);
  await assert.rejects(assertPaidEncarArchiveDigest({...binding, snapshotAttempt: '3'}, [archive]), /future_attempt/);
});
