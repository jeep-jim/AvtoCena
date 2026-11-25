import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {workflowTriggers, inspectWorkflow, collectWorkflowInventory, KNOWN_LEGACY_CHINA} from '../scripts/catalog-next/market-writer-inventory.mjs';

test('extracts triggers only from the workflow on block', () => {
  const source = 'name: Sample\non:\n  schedule:\n    - cron: "0 14 * * *"\n  workflow_dispatch:\n  workflow_run:\n    workflows: ["test"]\njobs:\n  publish:\n    if: true\n';
  assert.deepEqual(workflowTriggers(source), ['schedule', 'workflow_dispatch', 'workflow_run']);
  assert.deepEqual(workflowTriggers('name: sample\njobs:\n  workflow_dispatch:\n'), []);
});

test('distinguishes legacy source presence from confirmed activation', () => {
  const content = 'name: Old publisher\non:\n  workflow_dispatch:\njobs:\n  publish:\n    uses: ./.github/workflows/catalog-market-refresh.yml\n    with:\n      operation: recover_existing_intake\n';
  const info = inspectWorkflow('catalog-refresh-china.yml', content);
  assert.equal(info.knownLegacyChina, true);
  assert.equal(info.reviewCandidate, true);
  assert.deepEqual(info.signals, ['shared-publisher', 'fixed-old-china-publisher']);
  assert.ok(info.marketHints.includes('china'));
  assert.equal(Object.hasOwn(info, 'enabled'), false);
});

test('collects deterministic, read-only evidence without copying secrets', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'market-inventory-'));
  try {
    const dir = path.join(root, '.github/workflows'); await fs.mkdir(dir, {recursive: true});
    await fs.writeFile(path.join(dir, 'catalog-refresh-china.yml'), 'name: China\non:\n  schedule:\njobs:\n  a:\n    run: echo SECRET_EXAMPLE\n');
    await fs.writeFile(path.join(dir, 'catalog-refresh-korea.yml'), 'name: Korea\non:\n  workflow_dispatch:\n');
    const value = await collectWorkflowInventory(root);
    assert.equal(value.scannedWorkflowCount, 2);
    assert.equal(value.kind, 'market-writer-source-inventory');
    assert.equal(value.knownLegacyChina.length, KNOWN_LEGACY_CHINA.length);
    assert.equal(value.knownLegacyChina[0].presentInMain, true);
    assert.equal(value.knownLegacyChina[1].presentInMain, false);
    assert.equal(JSON.stringify(value).includes('SECRET_EXAMPLE'), false);
    assert.deepEqual(value.candidates.map(x => x.workflow), [
      '.github/workflows/catalog-refresh-china.yml', '.github/workflows/catalog-refresh-korea.yml',
    ]);
  } finally { await fs.rm(root, {recursive: true, force: true}); }
});
