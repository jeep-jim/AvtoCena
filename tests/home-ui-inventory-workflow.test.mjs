import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const execute = promisify(execFile), root = fileURLToPath(new URL('..', import.meta.url));
const packagePath = '.github/operations/home-ui-only-20261123';
const inventoryDigest = 'f9ba6713f076c211f5ac75086a83021383f06a1c231c158edffa7a51db1092f0';
const hostDigest = 'fd37f98aab3eeb16f131fcd4033adbb56f7e9616208c2f1ab5ef7a446caa4e4c';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test('inventory entrypoint permits only manual or one exact main marker, remains read-only, and has no release step', async () => {
  const workflow = await fs.readFile(path.join(root, '.github/workflows/home-ui-runtime-inventory.yml'), 'utf8');
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.match(workflow, /  push:\n    branches: \[main\]\n    paths: \['\.github\/market-runs\/home-ui-runtime-inventory\.json'\]/);
  assert.doesNotMatch(workflow, /^\s+(?:schedule|workflow_run|pull_request|pull_request_target):/m);
  assert.match(workflow, /github\.repository_id == '1289722938'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /github\.run_attempt == '1'/);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.doesNotMatch(workflow, /contents: write|actions: write|catalog-publish|catalog-refresh|docker (?:run|start|stop)|regcloud-deploy/);
  assert.match(workflow, /EXPECTED_CONTROLLER_SHA.*inputs\.controller_sha/);
  assert.match(workflow, /fetch-depth: 2/);
  assert.match(workflow, /node \.github\/operations\/home-ui-only-20261123\/assert-invocation\.mjs/);
  const nodeTests = 'node --test tests/home-ui-release-controller.test.mjs tests/readonly-marker-invocation.test.mjs tests/home-ui-inventory-workflow.test.mjs';
  assert.ok(workflow.includes(nodeTests));
  const ci = await fs.readFile(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  const check = ci.indexOf('      - name: Verify exact home UI controller and read-only invocation\n');
  assert.ok(check > ci.indexOf('node scripts/verify-frozen-speed-baselines.mjs'));
  const step = ci.slice(check, ci.indexOf('      - name:', check + 1));
  assert.ok(step.includes(nodeTests));
  assert.ok(step.includes('python3 -I -B tests/home-ui-runtime-inventory.test.py'));
  assert.doesNotMatch(step, /continue-on-error|\n\s+if:/);
  assert.match(workflow, /secrets\.REGCLOUD_SSH_KEY/);
  assert.match(workflow, /environment: regcloud-staging/);
  assert.match(workflow, /validate-inventory\.mjs home-ui-runtime-inventory\.json/);
  assert.equal(digest(await fs.readFile(path.join(root, packagePath, 'inventory.py'))), inventoryDigest);
  assert.equal(digest(await fs.readFile(path.join(root, 'docs/operations/regcloud-staging-known-hosts'))), hostDigest);
});

async function fixture(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'home-inventory-ssh-test-'));
  try {
    await fs.mkdir(path.join(directory, packagePath), {recursive:true});
    await fs.mkdir(path.join(directory, 'docs/operations'), {recursive:true});
    await fs.mkdir(path.join(directory, 'scripts/lib'), {recursive:true});
    await fs.mkdir(path.join(directory, 'runner'));
    await fs.copyFile(path.join(root, packagePath, 'inventory.py'), path.join(directory, packagePath, 'inventory.py'));
    await fs.copyFile(path.join(root, packagePath, 'assert-invocation.mjs'), path.join(directory, packagePath, 'assert-invocation.mjs'));
    await fs.copyFile(path.join(root, 'scripts/lib/readonly-marker-invocation.mjs'), path.join(directory, 'scripts/lib/readonly-marker-invocation.mjs'));
    await fs.copyFile(path.join(root, 'docs/operations/regcloud-staging-known-hosts'), path.join(directory, 'docs/operations/regcloud-staging-known-hosts'));
    const original = await fs.readFile(path.join(root, packagePath, 'read-inventory-over-ssh.sh'), 'utf8');
    assert.equal((original.match(/\/usr\/bin\/ssh/g) || []).length, 1);
    // The checked-in wrapper has no alternate SSH implementation option. Only
    // this disposable test copy replaces its single executable with a spy.
    const spy = path.join(directory, 'ssh-spy.mjs');
    await fs.writeFile(spy, `#!/usr/bin/env node
import fs from 'node:fs';import {createHash} from 'node:crypto';
const args=process.argv.slice(2),key=args[args.indexOf('-i')+1];
const stdin=fs.readFileSync(0);
fs.writeFileSync(process.env.SPY_RECEIPT,JSON.stringify({args,stdinSha256:createHash('sha256').update(stdin).digest('hex'),
 keyMode:fs.statSync(key).mode&0o777,keyMatches:fs.readFileSync(key,'utf8')==='synthetic-key-only\\n',secretInEnvironment:'SSH_PRIVATE_KEY' in process.env}));
process.stdout.write(JSON.stringify({readOnly:true,activationAuthorized:false})+'\\n');
`);
    await fs.chmod(spy, 0o755);
    const wrapper = path.join(directory, packagePath, 'read-inventory-over-ssh.sh');
    await fs.writeFile(wrapper, original.replace('/usr/bin/ssh', spy));
    const git = async args => (await execute('git', ['-c', 'user.name=Inventory test', '-c', 'user.email=inventory-test@example.invalid', ...args], {cwd:directory})).stdout.trim();
    await git(['init', '-q', '--initial-branch=main']); await git(['add', '--all']); await git(['commit', '-qm', 'synthetic test only']);
    const source = await git(['rev-parse', 'HEAD']);
    const env = {...process.env,
      GITHUB_REPOSITORY:'jeep-jim/AvtoCena', GITHUB_REPOSITORY_ID:'1289722938', GITHUB_REF:'refs/heads/main',
      GITHUB_EVENT_NAME:'workflow_dispatch', GITHUB_RUN_ATTEMPT:'1', GITHUB_SHA:source, EXPECTED_CONTROLLER_SHA:source,
      RUNNER_TEMP:path.join(directory, 'runner'), SSH_PRIVATE_KEY:'synthetic-key-only', SPY_RECEIPT:path.join(directory, 'spy.json')};
    await run({directory, wrapper, env, git, source});
  } finally { await fs.rm(directory, {recursive:true, force:true}); }
}

test('actual SSH wrapper sends only the pinned program to a pinned host and cleans its local key', async () => fixture(async ({directory, wrapper, env}) => {
  const output = await execute('bash', [wrapper], {cwd:directory, env, timeout:10000});
  const spy = JSON.parse(await fs.readFile(env.SPY_RECEIPT, 'utf8'));
  assert.equal(spy.stdinSha256, inventoryDigest);
  assert.equal(spy.keyMode, 0o600); assert.equal(spy.keyMatches, true); assert.equal(spy.secretInEnvironment, false);
  assert.equal(spy.args.at(-2), 'root@151.248.113.177');
  assert.equal(spy.args.at(-1), '/usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/python3 -I -B -');
  for (const option of ['StrictHostKeyChecking=yes','GlobalKnownHostsFile=/dev/null','UpdateHostKeys=no','ClearAllForwardings=yes','BatchMode=yes','IdentitiesOnly=yes']) {
    assert.ok(spy.args.includes(option), option);
  }
  assert.ok(spy.args.includes('UserKnownHostsFile=' + path.join(directory, 'docs/operations/regcloud-staging-known-hosts')));
  assert.deepEqual(await fs.readdir(env.RUNNER_TEMP), []);
  assert.doesNotMatch(output.stdout + output.stderr, /synthetic-key-only/);
}));

test('changed source, changed SSH key pins, wrong controller or repeated run never reach SSH', async () => {
  for (const mode of ['program','host','controller','branch','attempt']) await fixture(async ({directory, wrapper, env}) => {
    if (mode === 'program') await fs.appendFile(path.join(directory, packagePath, 'inventory.py'), '\n# changed\n');
    if (mode === 'host') await fs.appendFile(path.join(directory, 'docs/operations/regcloud-staging-known-hosts'), '\n# changed\n');
    if (mode === 'controller') env.EXPECTED_CONTROLLER_SHA = 'b'.repeat(40);
    if (mode === 'branch') env.GITHUB_REF = 'refs/heads/unreviewed';
    if (mode === 'attempt') env.GITHUB_RUN_ATTEMPT = '2';
    await assert.rejects(execute('bash', [wrapper], {cwd:directory, env, timeout:10000}));
    await assert.rejects(fs.access(env.SPY_RECEIPT));
    assert.deepEqual(await fs.readdir(env.RUNNER_TEMP), []);
  });
});

test('the SSH wrapper re-verifies a real marker commit and blocks wrong parent, extra files, non-main and replay before SSH', async () => {
  for (const mode of ['valid','parent','extra','branch','attempt']) await fixture(async ({directory, wrapper, env, git, source}) => {
    const marker = '.github/market-runs/home-ui-runtime-inventory.json';
    await fs.mkdir(path.join(directory, '.github/market-runs'), {recursive:true});
    await fs.writeFile(path.join(directory, marker), JSON.stringify({version:1, operation:'read-home-ui-runtime-20261123',
      approvedSourceSha:mode === 'parent' ? 'b'.repeat(40) : source}));
    if (mode === 'extra') await fs.writeFile(path.join(directory, 'extra.txt'), 'unreviewed');
    await git(['add', '--all']); await git(['commit', '-qm', 'synthetic marker only']);
    env.GITHUB_SHA = await git(['rev-parse','HEAD']); env.GITHUB_EVENT_NAME = 'push'; env.EXPECTED_CONTROLLER_SHA = '';
    env.GITHUB_EVENT_PATH = path.join(env.RUNNER_TEMP, 'event.json');
    await fs.writeFile(env.GITHUB_EVENT_PATH, JSON.stringify({before:source, after:env.GITHUB_SHA, ref:'refs/heads/main', created:false, deleted:false, forced:false}));
    if (mode === 'branch') env.GITHUB_REF = 'refs/heads/other';
    if (mode === 'attempt') env.GITHUB_RUN_ATTEMPT = '2';
    if (mode === 'valid') {
      await execute('bash', [wrapper], {cwd:directory, env, timeout:10000});
      const spy = JSON.parse(await fs.readFile(env.SPY_RECEIPT, 'utf8'));
      assert.equal(spy.stdinSha256, inventoryDigest); assert.equal(spy.secretInEnvironment, false);
    } else {
      await assert.rejects(execute('bash', [wrapper], {cwd:directory, env, timeout:10000}));
      await assert.rejects(fs.access(env.SPY_RECEIPT));
    }
    assert.deepEqual(await fs.readdir(env.RUNNER_TEMP), ['event.json']);
  });
});
