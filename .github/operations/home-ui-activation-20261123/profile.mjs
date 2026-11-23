import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {verifyReadonlyInvocation} from '../../../scripts/lib/readonly-marker-invocation.mjs';

export const ACTIVATION_MARKER = '.github/market-runs/home-ui-activation.json';
export const APPROVAL_MARKER = '.github/market-runs/home-ui-plan-approval.json';
export const APPROVAL_WORKFLOW = '.github/workflows/home-ui-plan-approval.yml';
export const CONTROLLER_ROOT = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
export const REVIEWED_INVENTORY_SHA = 'c23377808905f6a39deca0dbc6c3f482467b7635f23c9eb3074a5096e328d432';
export const INVENTORY_FILE = 'docs/audits/2026-11-23-home-runtime-after-cpu.json';
const need = (value, code) => { if (!value) throw Error('home_activation_' + code); };

export const checkActivationInvocation = (root = CONTROLLER_ROOT, env = process.env) =>
  verifyReadonlyInvocation({root, env, markerPath:ACTIVATION_MARKER, operation:'prepare-home-ui-catalog-18e8'});

// Keep the accepted three-field marker contract. The operation itself binds the
// reviewed plan digest, waiting run and one-use nonce; no caller-supplied code.
export function approvalOperation({runId, nonce, planSha256}) {
  need(/^[1-9][0-9]{0,19}$/.test(String(runId)) && /^[a-f0-9]{32}$/.test(nonce || '')
    && /^[a-f0-9]{64}$/.test(planSha256 || ''), 'approval_tuple');
  return `approve-home-ui-catalog-18e8-run-${runId}-nonce-${nonce}-plan-${planSha256}`;
}

export function parseApprovalOperation(operation) {
  const match = /^approve-home-ui-catalog-18e8-run-([1-9][0-9]{0,19})-nonce-([a-f0-9]{32})-plan-([a-f0-9]{64})$/.exec(operation || '');
  need(match, 'approval_operation');
  return {runId:match[1], nonce:match[2], planSha256:match[3]};
}

export function checkApprovalInvocation(root = CONTROLLER_ROOT, env = process.env) {
  need(env.GITHUB_EVENT_NAME === 'push', 'approval_push_required');
  let marker;
  try { marker = JSON.parse(execFileSync('git', ['--no-optional-locks','show','HEAD:' + APPROVAL_MARKER],
    {cwd:root, encoding:'utf8', stdio:['ignore','pipe','pipe'], maxBuffer:65536})); }
  catch { throw Error('home_activation_approval_marker'); }
  const tuple = parseApprovalOperation(marker.operation);
  const proof = verifyReadonlyInvocation({root,env,markerPath:APPROVAL_MARKER,operation:approvalOperation(tuple)});
  return {version:1,status:'verified_exact_home_plan_marker',...tuple,
    sourceSha:proof.sourceSha,approvedSourceSha:proof.approvedSourceSha,
    approvalRunId:String(env.GITHUB_RUN_ID),approvalRunAttempt:1};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === '--check-start' && process.argv.length === 3) console.log(JSON.stringify(checkActivationInvocation()));
    else if (process.argv[2] === '--record-approval' && process.argv.length === 3) {
      const proof = checkApprovalInvocation();
      need(/^[1-9][0-9]{0,19}$/.test(proof.approvalRunId), 'approval_run');
      const directory = path.join(fs.realpathSync(process.env.RUNNER_TEMP), 'home-ui-plan-approval');
      fs.mkdirSync(directory,{mode:0o700});
      fs.writeFileSync(path.join(directory,'approval.json'),JSON.stringify(proof,null,2)+'\n',{mode:0o600,flag:'wx'});
      console.log(JSON.stringify(proof));
    } else throw Error('home_activation_arguments');
  } catch { console.error('home_activation_invocation_unverified'); process.exitCode=1; }
}
