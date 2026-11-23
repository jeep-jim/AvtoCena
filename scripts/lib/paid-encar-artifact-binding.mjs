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

/** A saved producer remains bound to its own run, attempt and source SHA.
 * The recovery publisher's newer commit never relabels the collected evidence.
 */
export function paidEncarBindingFromWorkflow(env) {
  const sameRun = env.PREPARED_ENCAR_SELF === 'true';
  const sourceSha = env.PREPARED_ENCAR_SOURCE_SHA || '';
  if (!sameRun && !sourceSha) {
    if (env.PREPARED_ENCAR_ATTEMPT || env.PREPARED_ENCAR_ARTIFACT_ID || env.PREPARED_ENCAR_ARTIFACT_DIGEST) {
      throw Error('unexpected_prepared_encar_binding');
    }
    return null;
  }
  if (sameRun && sourceSha) fail('source_mode');
  if (!sameRun && env.PREPARED_ENCAR_RUN === env.GITHUB_RUN_ID) fail('saved_run');
  return validatePaidEncarArtifactBinding({
    runId:sameRun ? env.GITHUB_RUN_ID : env.PREPARED_ENCAR_RUN,
    currentAttempt:sameRun ? env.GITHUB_RUN_ATTEMPT : env.PREPARED_ENCAR_ATTEMPT,
    snapshotAttempt:env.PREPARED_ENCAR_ATTEMPT,
    artifactId:env.PREPARED_ENCAR_ARTIFACT_ID,
    artifactDigest:env.PREPARED_ENCAR_ARTIFACT_DIGEST,
    repositoryId:env.GITHUB_REPOSITORY_ID,
    headSha:sameRun ? env.GITHUB_SHA : sourceSha,
  }, {preparedRunId:env.PREPARED_ENCAR_RUN});
}

/** A downstream publication failure does not invalidate a completed preparation.
 * Verify the original attempt's successful snapshot, restoration and upload steps
 * before reusing its exact immutable artifact; never run the supplier again here.
 */
export function assertPaidEncarPreparedRun(binding, run, jobs) {
  const expected = validatePaidEncarArtifactBinding(binding);
  if (metadataInteger(run?.id, 'prepared_run_id') !== expected.runId
      || run.head_sha !== expected.headSha || run.head_branch !== 'main'
      || metadataInteger(run.repository?.id, 'prepared_repository') !== expected.repositoryId
      || metadataInteger(run.head_repository?.id, 'prepared_head_repository') !== expected.repositoryId
      || run.path !== '.github/workflows/catalog-refresh-korea.yml'
      || !['schedule', 'push'].includes(run.event)
      || run.status !== 'completed' || !['success', 'failure'].includes(run.conclusion)) fail('prepared_run');
  const currentAttempt = metadataInteger(run.run_attempt, 'prepared_current_attempt');
  validatePaidEncarArtifactBinding({...expected, currentAttempt});
  if (!Array.isArray(jobs)) fail('prepared_jobs');
  const requiredSteps = [
    'Verify this completed snapshot and current CRM before restoration',
    'Restore paid listings and prepare their saved history and inspection',
    'Run actions/upload-artifact@v4',
    'Bind the prepared artifact to the successful producer attempt',
  ];
  const prepared = jobs.filter(job => job?.run_id === Number(expected.runId)
    && job.run_attempt === Number(expected.snapshotAttempt) && job.head_sha === expected.headSha
    && job.head_branch === 'main' && job.status === 'completed' && job.conclusion === 'success'
    && Array.isArray(job.steps) && requiredSteps.every(name => job.steps.some(step =>
      step.name === name && step.status === 'completed' && step.conclusion === 'success')));
  if (prepared.length !== 1) fail('prepared_job');
  return {runId:expected.runId, snapshotAttempt:expected.snapshotAttempt,
    jobId:metadataInteger(prepared[0].id, 'prepared_job_id'), sourceSha:expected.headSha};
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
