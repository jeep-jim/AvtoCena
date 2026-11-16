import {createHash} from 'node:crypto';

const fields = ['runId', 'currentAttempt', 'snapshotAttempt', 'artifactId', 'artifactDigest', 'repositoryId', 'headSha'];
const positiveInteger = /^[1-9][0-9]*$/;

function fail(field) {
  throw Error(`paid_encar_artifact_binding_${field}`);
}

function contextInteger(value, field) {
  if (typeof value !== 'string' || !positiveInteger.test(value)) fail(field);
  return value;
}

function metadataInteger(value, field) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 1) fail(field);
    return String(value);
  }
  return contextInteger(value, field);
}

/** Caller context comes from GitHub identities and the successful upload outputs.
 * A publisher-only rerun may reuse an earlier producer attempt from this same run.
 */
export function validatePaidEncarArtifactBinding(binding, {preparedRunId} = {}) {
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) fail('context');
  if (Object.keys(binding).length !== fields.length || fields.some(field => !Object.hasOwn(binding, field))) fail('context_fields');
  const result = Object.fromEntries(fields.map(field => [field, binding[field]]));
  for (const field of ['runId', 'currentAttempt', 'snapshotAttempt', 'artifactId', 'repositoryId']) contextInteger(result[field], field);
  if (typeof result.headSha !== 'string' || !/^[a-f0-9]{40}$/.test(result.headSha)) fail('headSha');
  if (typeof result.artifactDigest !== 'string' || !/^[a-f0-9]{64}$/.test(result.artifactDigest)) fail('artifactDigest');
  const {snapshotAttempt, currentAttempt} = result;
  if (snapshotAttempt.length > currentAttempt.length ||
      (snapshotAttempt.length === currentAttempt.length && snapshotAttempt > currentAttempt)) fail('future_attempt');
  if (preparedRunId !== undefined && contextInteger(preparedRunId, 'prepared_run') !== result.runId) fail('prepared_run');
  return Object.freeze(result);
}

/** Validate GET /actions/artifacts/{id} metadata; this helper performs no I/O. */
export function assertPaidEncarArtifactBinding(binding, artifact) {
  const expected = validatePaidEncarArtifactBinding(binding);
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) fail('metadata');
  if (metadataInteger(artifact.id, 'artifact_id') !== expected.artifactId) fail('artifact_id');
  if (artifact.expired !== false) fail('expired');
  if (artifact.name !== `catalog-intake-korea-${expected.runId}-${expected.snapshotAttempt}`) fail('name');
  if (artifact.digest !== `sha256:${expected.artifactDigest}`) fail('digest');
  const run = artifact.workflow_run;
  if (!run || typeof run !== 'object' || Array.isArray(run)) fail('workflow_run');
  if (metadataInteger(run.id, 'run_id') !== expected.runId) fail('run_id');
  if (metadataInteger(run.repository_id, 'repository_id') !== expected.repositoryId) fail('repository_id');
  if (metadataInteger(run.head_repository_id, 'head_repository_id') !== expected.repositoryId) fail('head_repository_id');
  if (run.head_sha !== expected.headSha) fail('head_sha');
  if (run.head_branch !== 'main') fail('head_branch');
  return expected;
}

/** Verify downloaded archive bytes before extraction; an action warning is not a publication gate. */
export async function assertPaidEncarArchiveDigest(binding, chunks) {
  const expected = validatePaidEncarArtifactBinding(binding);
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of chunks) {
    if (!(chunk instanceof Uint8Array)) fail('archive_bytes');
    bytes += chunk.byteLength;
    hash.update(chunk);
  }
  if (bytes === 0 || hash.digest('hex') !== expected.artifactDigest) fail('archive_digest');
  return expected;
}

/** Bind the restored report to the verified artifact's exact snapshot identity.
 * Offer normalization and the complete row-count proof remain publisher guards.
 */
export function assertPaidEncarReportBinding(binding, report, {now = Date.now()} = {}) {
  const expected = validatePaidEncarArtifactBinding(binding);
  const reject = field => {throw Error(`paid_encar_report_binding_${field}`);};
  if (!report || typeof report !== 'object' || Array.isArray(report)) reject('report');
  if (report.snapshotRun !== expected.runId) reject('snapshot_run');
  if (report.snapshotAttempt !== expected.snapshotAttempt) reject('snapshot_attempt');
  if (report.completed !== true || report.market !== 'korea' || report.provider !== 'auto_api_encar') reject('paid_snapshot');
  const age = now - Date.parse(report.completedAt);
  if (!Number.isFinite(age) || age < 0 || age > 3 * 86400000) reject('stale');
  if (!Array.isArray(report.sources) || report.sources.length !== 1) reject('sources');
  const source = report.sources[0];
  if (source?.sourceId !== 'encar_direct' || source.stopReason !== 'source_finished' ||
      !Number.isSafeInteger(source.uniqueOffers) || source.uniqueOffers < 1) reject('source');
  return expected;
}
