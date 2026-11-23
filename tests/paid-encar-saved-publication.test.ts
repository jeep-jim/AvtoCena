import test from 'node:test';
import assert from 'node:assert/strict';
import {paidEncarBindingFromWorkflow, assertPaidEncarPreparedRun,
  assertPaidEncarArtifactBinding} from '../scripts/lib/paid-encar-artifact-binding.mjs';

const sourceSha = 'c90dea655470d2970f5f22cc7d7f98c086874738';
const env = () => ({PREPARED_ENCAR_SELF:'false', PREPARED_ENCAR_RUN:'45077320093',
  PREPARED_ENCAR_SOURCE_SHA:sourceSha, PREPARED_ENCAR_ATTEMPT:'1',
  PREPARED_ENCAR_ARTIFACT_ID:'14779553850', PREPARED_ENCAR_ARTIFACT_DIGEST:'d'.repeat(64),
  GITHUB_REPOSITORY_ID:'1289722938', GITHUB_RUN_ID:'45099999999',
  GITHUB_RUN_ATTEMPT:'1', GITHUB_SHA:'f'.repeat(40)});
const evidence = () => ({
  run:{id:45077320093, run_attempt:1, path:'.github/workflows/catalog-refresh-korea.yml',
    event:'schedule', head_sha:sourceSha, head_branch:'main', status:'completed', conclusion:'failure',
    repository:{id:1289722938}, head_repository:{id:1289722938}},
  jobs:[{id:137403171884, run_id:45077320093, run_attempt:1, head_sha:sourceSha,
    head_branch:'main', status:'completed', conclusion:'success', steps:[
      'Verify this completed snapshot and current CRM before restoration',
      'Restore paid listings and prepare their saved history and inspection',
      'Run actions/upload-artifact@v4',
      'Bind the prepared artifact to the successful producer attempt',
    ].map(name => ({name, status:'completed', conclusion:'success'}))}],
});

test('recovery keeps the saved producer identity independently of the newer publisher', () => {
  const binding = paidEncarBindingFromWorkflow(env());
  assert.equal(binding.runId, '45077320093');
  assert.equal(binding.headSha, sourceSha);
  assert.equal(binding.snapshotAttempt, '1');
  assert.notEqual(binding.headSha, env().GITHUB_SHA);
  assert.notEqual(binding.runId, env().GITHUB_RUN_ID);
  const {run,jobs} = evidence();
  assert.deepEqual(assertPaidEncarPreparedRun(binding,run,jobs), {
    runId:binding.runId, snapshotAttempt:'1', jobId:'137403171884', sourceSha,
  });
  assertPaidEncarArtifactBinding(binding,{id:14779553850, expired:false,
    name:'catalog-intake-korea-45077320093-1', digest:'sha256:' + 'd'.repeat(64),
    workflow_run:{id:45077320093, repository_id:1289722938, head_repository_id:1289722938,
      head_sha:sourceSha, head_branch:'main'}});
});

test('legacy prepared input remains separate; incomplete or ambiguous new bindings are refused', () => {
  assert.equal(paidEncarBindingFromWorkflow({PREPARED_ENCAR_RUN:'400'}), null);
  for (const changed of [
    {PREPARED_ENCAR_SOURCE_SHA:''}, {PREPARED_ENCAR_SELF:'true'},
    {PREPARED_ENCAR_RUN:env().GITHUB_RUN_ID}, {PREPARED_ENCAR_ARTIFACT_ID:''},
  ]) assert.throws(() => paidEncarBindingFromWorkflow({...env(),...changed}),
    /unexpected_prepared_encar_binding|paid_encar_artifact_binding_/);
});

test('a downstream failed run is reusable only after all original preparation steps succeed', () => {
  const binding = paidEncarBindingFromWorkflow(env());
  for (const index of [0,1,2,3]) {
    const {run,jobs} = evidence();
    jobs[0].steps[index].conclusion = 'skipped';
    assert.throws(() => assertPaidEncarPreparedRun(binding,run,jobs), /prepared_job/);
  }
  for (const alter of [
    value => {value.run.status='in_progress';},
    value => {value.run.conclusion='cancelled';},
    value => {value.run.head_sha='a'.repeat(40);},
    value => {value.run.head_repository.id++;},
    value => {value.run.path='.github/workflows/unrelated.yml';},
    value => {value.jobs[0].run_attempt=2;},
    value => {value.jobs[0].head_sha='a'.repeat(40);},
    value => {value.jobs[0].head_branch='feature/other';},
    value => {value.jobs[0].conclusion='failure';},
    value => {value.jobs.push({...value.jobs[0],id:137403171885});},
  ]) {
    const value = evidence(); alter(value);
    assert.throws(() => assertPaidEncarPreparedRun(binding,value.run,value.jobs), /paid_encar_artifact_binding_/);
  }
});
