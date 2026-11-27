import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JAPAN_CACHE_COMPACTION_PROFILE as PROFILE} from '../scripts/catalog-next/japan-cache-compaction-entry.mjs';

const workflow = new URL('../.github/workflows/japan-cache-compaction.yml', import.meta.url);
const script = 'scripts/catalog-next/japan-cache-compaction-entry.mjs';

test('compaction workflow starts with its marker and serializes hourly continuations with releases and China data work', async () => {
  const source = await fs.readFile(workflow, 'utf8');
  assert(source.includes(`paths: [${PROFILE.markerPath}]`));
  assert(source.includes('branches: [main]'));
  assert(source.includes(`schedule:\n    - cron: '${PROFILE.schedule}'`));
  assert.equal((source.match(/cron:/g) || []).length, 1);
  assert(source.includes("if: github.repository_id == '1289722938' && github.ref == 'refs/heads/main' && github.run_attempt == '1'"));
  assert(source.includes('jobs:\n  compact:'));
  assert(source.includes('concurrency:\n  group: catalog-next-china\n  cancel-in-progress: false'));
  assert(source.includes('timeout-minutes: 10'));
  assert(source.includes('workflow_dispatch:\n    inputs:\n      expected_controller_sha:'));
  assert(source.includes('EXPECTED_CONTROLLER_SHA: ${{ inputs.expected_controller_sha }}'));
  assert(source.includes('permissions:\n  contents: read\n'));
  assert(source.includes('fetch-depth: 2\n          persist-credentials: false'));
  for (const forbidden of ['pull_request', 'workflow_call:', 'workflow_run:', 'contents: write', 'actions: write',
    'id-token:', 'cancel-in-progress: true', 'continue-on-error:', 'npm ci', 'npm install']) assert(!source.includes(forbidden), forbidden);
});

test('offline invocation, frozen baselines and all compaction fences precede storage credentials', async () => {
  const source = await fs.readFile(workflow, 'utf8'), firstSecret = source.indexOf('secrets.');
  assert(firstSecret > 0);
  const before = source.slice(0, firstSecret);
  for (const command of ['node scripts/verify-frozen-speed-baselines.mjs', `node --check ${script}`,
    'node --check scripts/catalog-next/japan-cache-compaction.mjs', `node ${script} --verify`,
    'node --import ./tests/helpers/offline-fetch.mjs --test --test-concurrency=1 tests/catalog-next-japan-cache-compaction.test.mjs tests/catalog-next-japan-cache-compaction-entry.test.mjs tests/catalog-next-japan-cache-compaction-workflow.test.mjs tests/readonly-marker-invocation.test.mjs']) {
    assert(before.includes(command), command);
  }
  assert(source.includes('environment: regcloud-staging'));
  assert(source.includes('REGCLOUD_S3_ACCESS_KEY_ID: ${{ secrets.REGCLOUD_S3_ACCESS_KEY_ID }}'));
  assert(source.includes('REGCLOUD_S3_SECRET_ACCESS_KEY: ${{ secrets.REGCLOUD_S3_SECRET_ACCESS_KEY }}'));
  assert.equal((source.match(/secrets\./g) || []).length, 2);
  assert(source.includes(`umask 077\n          node ${script} --compact`));
  assert(source.includes('actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683'));
  assert(source.includes('actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020'));
  assert(source.includes("node-version: '24.22.3'"));
  const commands = source.split(/\n        run: \|\n/).slice(1).map(value => value.split(/\n      - /, 1)[0]);
  assert.equal(commands.length, 2);
  assert(commands.every(value => !value.includes('${{')), 'inputs are passed through env, not shell code');
  for (const forbidden of ['|| true', 'set -x', 'ssh ', 'curl ', 'aws ', 'AJES_API_PASSWORD', 'SSH_PRIVATE_KEY', 'delete-object', 'prune'])
    assert(!source.includes(forbidden), forbidden);
});

test('artifact upload has one fixed sanitized report and never uploads state, cursor or cache bodies', async () => {
  const source = await fs.readFile(workflow, 'utf8');
  assert.equal((source.match(/uses: actions\/upload-artifact@/g) || []).length, 1);
  assert.equal((source.match(/\bpath:/g) || []).length, 1);
  assert(source.includes(`path: ${PROFILE.reportName}\n          if-no-files-found: ignore\n          retention-days: 14`));
  assert(!source.includes('path: .') && !source.includes('path: /tmp') && !source.includes('include-hidden-files'));
});
