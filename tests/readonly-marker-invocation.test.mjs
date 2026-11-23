import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {verifyReadonlyInvocation} from '../scripts/lib/readonly-marker-invocation.mjs';

const execute = promisify(execFile);
const markerPath = '.github/market-runs/home-ui-runtime-inventory.json';
const operation = 'read-home-ui-runtime-20261123';
const git = async (root, args) => (await execute('git', ['-c', 'user.name=Read-only test',
  '-c', 'user.email=readonly-test@example.invalid', ...args], {cwd:root})).stdout.trim();

async function fixture(run, existing = false) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'readonly-invocation-'));
  const root = path.join(directory, 'repo'), eventPath = path.join(directory, 'event.json');
  try {
    await fs.mkdir(path.join(root, '.github/market-runs'), {recursive:true});
    await git(root, ['init', '-q', '--initial-branch=main']);
    await fs.writeFile(path.join(root, 'controller.txt'), 'reviewed controller\n');
    if (existing) await fs.writeFile(path.join(root, markerPath), JSON.stringify({version:1, operation, approvedSourceSha:'0'.repeat(40)}));
    const commit = async () => {
      await git(root, ['add', '--all']);
      await git(root, ['commit', '-qm', 'synthetic test only']);
      return git(root, ['rev-parse', 'HEAD']);
    };
    const accepted = await commit();
    const env = {GITHUB_REPOSITORY:'jeep-jim/AvtoCena', GITHUB_REPOSITORY_ID:'1289722938',
      GITHUB_REF:'refs/heads/main', GITHUB_RUN_ATTEMPT:'1', GITHUB_EVENT_NAME:'workflow_dispatch',
      GITHUB_SHA:accepted, EXPECTED_CONTROLLER_SHA:accepted, GITHUB_EVENT_PATH:eventPath};
    const profile = {root, env, markerPath, operation};
    const push = async ({marker = {version:1, operation, approvedSourceSha:accepted}, extra = false} = {}) => {
      await fs.writeFile(path.join(root, markerPath), JSON.stringify(marker));
      if (extra) await fs.writeFile(path.join(root, 'controller.txt'), 'unreviewed change\n');
      const sourceSha = await commit();
      env.GITHUB_EVENT_NAME = 'push'; env.GITHUB_SHA = sourceSha; env.EXPECTED_CONTROLLER_SHA = '';
      const event = {before:accepted, after:sourceSha, ref:'refs/heads/main', created:false, deleted:false, forced:false};
      await fs.writeFile(eventPath, JSON.stringify(event));
      return event;
    };
    await run({directory, root, accepted, env, profile, push, commit, eventPath});
  } finally { await fs.rm(directory, {recursive:true, force:true}); }
}

test('manual entrypoint requires the exact main checkout, repository, first attempt and supplied source', async () => fixture(async ({profile, env, root}) => {
  assert.equal(verifyReadonlyInvocation(profile).sourceSha, env.GITHUB_SHA);
  for (const [key, value] of [['GITHUB_REPOSITORY','foreign/repo'], ['GITHUB_REPOSITORY_ID','1'],
    ['GITHUB_REF','refs/heads/other'], ['GITHUB_RUN_ATTEMPT','2'], ['GITHUB_EVENT_NAME','schedule'],
    ['GITHUB_SHA','a'.repeat(40)], ['EXPECTED_CONTROLLER_SHA','b'.repeat(40)]]) {
    assert.throws(() => verifyReadonlyInvocation({...profile, env:{...env, [key]:value}}), /readonly_invocation_/);
  }
  await fs.writeFile(path.join(root, 'controller.txt'), 'uncommitted change\n');
  assert.throws(() => verifyReadonlyInvocation(profile), /git_unverified/);
}));

test('a single A or M marker commit passes with its accepted parent, including a depth-two checkout', async () => {
  for (const existing of [false, true]) await fixture(async ({profile, accepted, push, root, directory}) => {
    await push();
    const receipt = verifyReadonlyInvocation(profile);
    assert.deepEqual(receipt, {version:1, event:'push', sourceSha:profile.env.GITHUB_SHA, approvedSourceSha:accepted, markerPath});
    const clone = path.join(directory, 'shallow');
    await execute('git', ['clone', '--quiet', '--depth=2', pathToFileURL(root).href, clone]);
    assert.equal(verifyReadonlyInvocation({...profile, root:clone}).approvedSourceSha, accepted);
  }, existing);
});

test('wrong approved parent, another changed file and a merge commit cannot authorize the marker', async () => {
  for (const mode of ['parent','extra','merge']) await fixture(async ({profile, accepted, push, root, eventPath}) => {
    await push(mode === 'parent' ? {marker:{version:1, operation, approvedSourceSha:'b'.repeat(40)}} : {extra:mode === 'extra'});
    if (mode === 'merge') {
      const tree = await git(root, ['rev-parse', 'HEAD^{tree}']);
      const merged = await git(root, ['commit-tree', tree, '-p', accepted, '-p', profile.env.GITHUB_SHA, '-m', 'synthetic merge']);
      await git(root, ['update-ref', 'HEAD', merged]); profile.env.GITHUB_SHA = merged;
      await fs.writeFile(eventPath, JSON.stringify({before:accepted, after:merged, ref:'refs/heads/main', created:false, deleted:false, forced:false}));
    }
    assert.throws(() => verifyReadonlyInvocation(profile), mode === 'extra' ? /marker_only_diff/ : /approved_parent/);
  });
});

test('push replay, non-main, foreign source and a multi-commit or forced transition fail closed', async () => fixture(async ({profile, push, eventPath}) => {
  const event = await push();
  for (const [key, value] of [['GITHUB_RUN_ATTEMPT','2'], ['GITHUB_REF','refs/heads/other'], ['GITHUB_SHA','c'.repeat(40)]]) {
    assert.throws(() => verifyReadonlyInvocation({...profile, env:{...profile.env, [key]:value}}), /readonly_invocation_/);
  }
  for (const changed of [{before:'b'.repeat(40)}, {after:'b'.repeat(40)}, {forced:true}, {created:true}, {deleted:true}, {ref:'refs/heads/other'}]) {
    await fs.writeFile(eventPath, JSON.stringify({...event, ...changed}));
    assert.throws(() => verifyReadonlyInvocation(profile), /push_transition/);
  }
}));

test('a stale marker in a later commit and unknown marker fields or operations are rejected', async () => {
  for (const mode of ['stale','operation','field','version']) await fixture(async ({profile, push, root, commit, accepted}) => {
    const marker = {version:1, operation, approvedSourceSha:accepted};
    if (mode === 'operation') marker.operation = 'another-operation';
    if (mode === 'field') marker.extra = true;
    if (mode === 'version') marker.version = 2;
    await push({marker});
    if (mode === 'stale') {
      await fs.appendFile(path.join(root, markerPath), '\n');
      profile.env.GITHUB_SHA = await commit();
    }
    assert.throws(() => verifyReadonlyInvocation(profile), mode === 'stale' ? /approved_parent/ : /marker_contract/);
  });
});

test('an approval fetch may hide the original traversal edge while the exact parent and both trees remain verifiable', async () => {
  await fixture(async ({profile, accepted, push, root, directory}) => {
    await push();
    const checkout = path.join(directory, 'controller');
    await execute('git', ['clone', '--quiet', '--depth=2', pathToFileURL(root).href, checkout]);
    assert.equal(verifyReadonlyInvocation({...profile, root:checkout}).approvedSourceSha, accepted);
    await fs.writeFile(path.join(root, 'next-approval.json'), '{}');
    await git(root, ['add', 'next-approval.json']);
    await git(root, ['commit', '-qm', 'next reviewed approval']);
    const next = await git(root, ['rev-parse', 'HEAD']);
    await git(checkout, ['fetch', '--no-write-fetch-head', '--depth=2', 'origin', next]);
    assert.equal(await git(checkout, ['rev-list', '--parents', '-n', '1', 'HEAD']), profile.env.GITHUB_SHA);
    assert.equal(verifyReadonlyInvocation({...profile, root:checkout}).approvedSourceSha, accepted);
  });
});
