import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const modes = ['audit', 'canary'];
const read = mode => fs.readFile(new URL(`../.github/workflows/japan-cache-retention-${mode}.yml`, import.meta.url), 'utf8');
const script = 'scripts/catalog-next/japan-cache-retention-audit.mjs';
const guard = "if: github.repository_id == '1289722938' && github.ref == 'refs/heads/main' && github.run_attempt == '1'";

for (const mode of modes) {
  test(`${mode} workflow admits only the exact main invocation and its dedicated marker`, async () => {
    const source = await read(mode);
    assert(source.includes(`paths: [.github/market-runs/japan-cache-retention-${mode}.json]`));
    assert(source.includes('branches: [main]'));
    assert(source.includes(guard));
    assert(source.includes('workflow_dispatch:\n    inputs:\n      expected_controller_sha:'));
    assert.match(source, /expected_controller_sha:\n        description: [^\n]+\n        required: true\n        type: string/);
    assert(source.includes('EXPECTED_CONTROLLER_SHA: ${{ inputs.expected_controller_sha }}'));
    assert(source.includes('permissions:\n  contents: read\n'));
    assert(source.includes('concurrency:\n  group: catalog-next-japan-cache-retention-verification\n  cancel-in-progress: false'));
    assert(source.includes('fetch-depth: 2\n          persist-credentials: false'));
    assert(source.includes('actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683'));
    assert(source.includes('actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020'));
    assert(source.includes("node-version: '24.22.3'"));
    for (const forbidden of ['schedule:', 'pull_request', 'workflow_call:', 'workflow_run:', 'contents: write',
      'actions: write', 'id-token:', 'cancel-in-progress: true', 'continue-on-error:', 'npm ci', 'npm install']) {
      assert(!source.includes(forbidden), forbidden);
    }
    assert(!source.includes(`--${mode === 'audit' ? 'canary' : 'audit'}`), 'the workflow must not run the other mode');
  });

  test(`${mode} workflow verifies local fences before exposing credentials and publishes only its aggregate report`, async () => {
    const source = await read(mode);
    const firstCredential = source.indexOf('secrets.REGCLOUD_');
    assert(firstCredential > 0);
    const checks = source.slice(0, firstCredential);
    for (const command of [
      'node scripts/verify-frozen-speed-baselines.mjs',
      `node --check ${script}`,
      `node ${script} --verify-${mode}`,
      'node --import ./tests/helpers/offline-fetch.mjs --test --test-concurrency=1 tests/catalog-next-japan-cache-retention.test.mjs tests/catalog-next-japan-cache-retention-workflow.test.mjs tests/readonly-marker-invocation.test.mjs',
    ]) assert(checks.includes(command), command);
    assert(!checks.includes('secrets.'));
    assert(source.includes('environment: regcloud-staging'));
    assert(source.includes('REGCLOUD_S3_ACCESS_KEY_ID: ${{ secrets.REGCLOUD_S3_ACCESS_KEY_ID }}'));
    assert(source.includes('REGCLOUD_S3_SECRET_ACCESS_KEY: ${{ secrets.REGCLOUD_S3_SECRET_ACCESS_KEY }}'));
    assert.equal((source.match(/secrets\./g) || []).length, 2);
    assert(source.includes(`umask 077\n          node ${script} --${mode}`));
    assert(source.includes(`path: japan-cache-retention-${mode}-report.json\n          if-no-files-found: ignore\n          retention-days: 14`));
    assert.equal((source.match(/uses: actions\/upload-artifact@/g) || []).length, 1);
    assert.equal((source.match(/\bpath:/g) || []).length, 1, 'artifact upload has no alternate raw-data path');
    for (const forbidden of ['|| true', '2>&1', 'set -x', 'ssh ', 'curl ', 'aws ', 'delete-object', 'delete-prefix',
      'AJES_API_PASSWORD', 'SSH_PRIVATE_KEY', '${{ inputs.expected_controller_sha }}\n          node']) {
      assert(!source.includes(forbidden), forbidden);
    }
    // Workflow inputs are allowed in env only, never in executable shell text.
    const commands = source.split(/\n        run: \|\n/).slice(1).map(value => value.split(/\n      - /, 1)[0]);
    assert(commands.length === 2);
    assert(commands.every(value => !value.includes('${{')));
  });
}

test('operator guide keeps the marker as an invalid template and distinguishes capability evidence from cache deletion', async () => {
  const guide = await fs.readFile(new URL('../docs/operations/japan-cache-retention-audit.md', import.meta.url), 'utf8');
  for (const mode of modes) {
    assert(guide.includes(`.github/market-runs/japan-cache-retention-${mode}.json`));
    assert(guide.includes(`japan-cache-retention-${mode}-v1`));
    assert(guide.includes(`japan-cache-retention-${mode}-report.json`));
  }
  assert(guide.includes('"approvedSourceSha": "<REVIEWED_CONTROLLER_SHA>"'));
  assert(guide.includes('В этом пути такого executor нет.'));
  assert(guide.includes('не удаляет рабочие объекты кэша'));
  assert(guide.includes('Расписания для этих workflow нет'));
  assert(guide.includes('неактуальные версии bucket и диск сервера учитываются отдельно'));
  assert(guide.includes('conditionalHeaderFormat: "bare"'));
  for (const field of ['stalePutStatus', 'updatedObjectPreservedAfterStalePut', 'currentObjectConditionalPutVerified',
    'staleDeleteStatus', 'matchingDeleteStatus']) assert(guide.includes(field));
  assert(guide.includes('1536 байт'));
  assert(guide.includes('8ecfe55a9e8db47c564bcea75faff6c797d65d3a'));
});
