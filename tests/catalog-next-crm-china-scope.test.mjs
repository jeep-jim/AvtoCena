import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {checkedCatalogCodeScope} from '../scripts/catalog-next/photo-code-scope.mjs';
import {CRM_CHINA_CODE_SCOPE, CRM_CHINA_CODE_PATHS, CRM_CHINA_RETAINED_RUNTIME, CRM_CHINA_PROTECTED_EXCEPTIONS}
  from '../scripts/catalog-next/crm-china-code-scope.mjs';
import {verifyChinaImageRuntime, executeImageCommand} from '../scripts/catalog-next/build-release-image.mjs';

const hash = raw => createHash('sha256').update(raw).digest('hex');
const plan = () => ({codeScope: CRM_CHINA_CODE_SCOPE, retainedRuntime: CRM_CHINA_RETAINED_RUNTIME,
  runtimeFiles: [...CRM_CHINA_CODE_PATHS]});

test('CRM is an exact six-file successor of accepted 077, separate from every Japan profile', () => {
  assert.equal(checkedCatalogCodeScope(plan()), CRM_CHINA_CODE_SCOPE);
  assert.equal(CRM_CHINA_CODE_PATHS.length, 6);
  assert.equal(CRM_CHINA_RETAINED_RUNTIME, '077cbb17626ab0c64e7f06db055fef9252ad21c0');
  for (const runtimeFiles of [CRM_CHINA_CODE_PATHS.slice(1), [...CRM_CHINA_CODE_PATHS, 'apps/web/lib/auth.ts'],
    [...CRM_CHINA_CODE_PATHS.slice(0, -1), CRM_CHINA_CODE_PATHS[0]]])
    assert.throws(() => checkedCatalogCodeScope({...plan(), runtimeFiles}), /china_photo_scope_files/);
  assert.throws(() => checkedCatalogCodeScope({...plan(), retainedRuntime: 'b25a95122199378afc5166ed7ac8882a84ed9fe3'}), /retained_runtime/);
  for (const codeScope of ['catalog-photo-recovery-v1', 'catalog-japan-completion-v2', 'catalog-japan-usability-v1'])
    assert.throws(() => checkedCatalogCodeScope({...plan(), codeScope}), /china_photo_scope_files/);
});

async function sourceFixture(t) {
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'crm-source-scope-'));
  t.after(() => fs.rm(runtimeRoot, {recursive: true, force: true}));
  const git = args => execFileSync('/usr/bin/git', args, {cwd: runtimeRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  const write = async (filename, content) => {
    await fs.mkdir(path.dirname(path.join(runtimeRoot, filename)), {recursive: true});
    await fs.writeFile(path.join(runtimeRoot, filename), content);
  };
  const commit = () => { git(['add', '.']); git(['-c', 'user.email=fixture@example.invalid', '-c', 'user.name=Fixture',
    'commit', '--quiet', '--no-gpg-sign', '-m', 'fixture']); };
  git(['init', '--quiet']);
  for (const filename of CRM_CHINA_CODE_PATHS) await write(filename, 'accepted original\n');
  await write('apps/web/app/(crm)/api/crm/team/route.ts', 'protected team authorization\n');
  await write('apps/web/components/site/BusinessSettings.tsx', 'protected business controls\n');
  commit(); const base = git(['rev-parse', 'HEAD']).trim();
  for (const filename of CRM_CHINA_CODE_PATHS) await write(filename, 'reviewed CRM status correction\n');
  commit();
  const currentPlan = () => ({...plan(), version: 1, market: 'china', runtimeSha: git(['rev-parse', 'HEAD']).trim(),
    runtimeTree: git(['rev-parse', 'HEAD^{tree}']).trim(),
    runtimeDiffSha256: hash(git(['diff', '--binary', '--full-index', '--no-ext-diff', '--no-renames', base, 'HEAD']))});
  const calls = [];
  // Only the immutable ancestor's object ID is mapped to this isolated fixture.
  // File diffs and literal protected-path exclusions are real Git operations.
  const execute = (command, args, options) => {
    calls.push(args);
    return executeImageCommand(command, args.map(value => value === CRM_CHINA_RETAINED_RUNTIME ? base : value), options);
  };
  return {runtimeRoot, git, write, commit, currentPlan, execute, calls};
}

test('image source check allows only the named CRM route and component inside protected trees', async t => {
  const f = await sourceFixture(t);
  const proof = await verifyChinaImageRuntime({...f, plan: f.currentPlan()});
  assert.deepEqual(proof.protectedPathExceptions, CRM_CHINA_PROTECTED_EXCEPTIONS);
  assert.equal(proof.protectedPathsUnchanged, true);
  assert.ok(f.calls.some(args => args.includes(':(exclude,literal)apps/web/app/(crm)/api/crm/china-catalog-status/route.ts')));
  await assert.rejects(verifyChinaImageRuntime({...f, plan: {...f.currentPlan(), codeScope: 'catalog-japan-usability-v1'}}),
    /china_image_command_failed/, 'the old profile retains its entire CRM/site protection');
  for (const file of ['apps/web/app/(crm)/api/crm/team/route.ts', 'apps/web/components/site/BusinessSettings.tsx']) {
    await f.write(file, 'unreviewed adjacent edit\n'); f.commit();
    const p = f.currentPlan();
    await assert.rejects(verifyChinaImageRuntime({...f, plan: p}), /china_image_runtime_scope/);
    await assert.rejects(verifyChinaImageRuntime({...f, plan: {...p, runtimeFiles: [...p.runtimeFiles, file]}}), /china_image_crm_scope/);
    f.git(['reset', '--hard', 'HEAD~1']);
  }
});

test('image check refuses another retained ancestor before any Git or build operation', async t => {
  const f = await sourceFixture(t);
  await assert.rejects(verifyChinaImageRuntime({...f, plan: {...f.currentPlan(), retainedRuntime: 'b'.repeat(40)},
    execute: async () => assert.fail('invalid CRM authority cannot execute commands')}), /china_image_crm_scope/);
});
