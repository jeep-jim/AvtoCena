import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {HOME_UI} from '../.github/operations/home-ui-only-20261123/contract.mjs';
import {imageBuildReceipt, RESOURCE_FILES, checkBuildInvocation, IMAGE_MARKER, IMAGE_OPERATION}
  from '../.github/operations/home-ui-adapter-20261123/build-image.mjs';
import {parseNodeOptions} from '../scripts/lib/node-resource-memory.mjs';

const root = fileURLToPath(new URL('..', import.meta.url)), run = promisify(execFile);
const proof = () => ({version:1, clean:true, reviewedFilterChangesOnly:true,
  ...Object.fromEntries(['source','tree','retainedSource','retainedTree','sourceCalculationVersion',
    'servingCalculationVersion','codeDiffSha256','sourceClosureRecords','codePaths'].map(key => [key, structuredClone(HOME_UI[key])]))});
const fixture = () => ({proof:proof(), imageArchiveSha256:'c'.repeat(64), controllerSha:'d'.repeat(40),
  inspection:{Id:'sha256:' + 'a'.repeat(64), Os:'linux', Architecture:'amd64', Size:12345, Config:{WorkingDir:'/app',
    Cmd:['node','apps/web/server.js'], Labels:{'org.opencontainers.image.revision':HOME_UI.source,
      'org.opencontainers.image.source':'https://github.com/jeep-jim/AvtoCena', 'avtocena.application':'web'}}},
  resourceFiles:Object.fromEntries(Object.keys(RESOURCE_FILES).map(key => [key, 'b'.repeat(64)])),
  probeLog:[{stage:'node_resource_memory',nodeVersion:'v24.22.1',actualHeapBytes:500*1048576,
    requestedHeapBytes:500*1048576,availableRamBytes:500*1048576+1024,usableSwapBytes:0,private:'never copy arbitrary fields'},
  {stage:'home_image_probe',passed:true,nodeVersion:'v24.22.1',modelAssetSha256:'ee5c872e9127430890f58abf239cddfa48553f86c3032799c9c29953b6109662',privateIndexInImage:false}]
    .map(value => JSON.stringify(value)).join('\n')});

test('build receipts require exact source, image, Node, asset and applied resource heap without claiming deployment', () => {
  const receipt = imageBuildReceipt(fixture());
  assert.equal(receipt.status, 'verified_exact_home_image_build');
  for (const key of ['activationAuthorized','hostContacted','runtimeChanged','imageArchivePublished','privateBindingVerified','privateServerGatePassed','browserGatePassed']) {
    assert.equal(receipt[key], false, key);
  }
  assert.doesNotMatch(JSON.stringify(receipt), /never copy arbitrary fields/);
  for (const change of [value => value.proof.clean = false,
    value => value.inspection.Config.Labels['org.opencontainers.image.revision'] = HOME_UI.retainedSource,
    value => value.inspection.Config.Cmd = ['node','other.js'],
    value => value.inspection.Architecture = 'arm64', value => value.imageArchiveSha256 = 'unknown', value => value.inspection.Size = 0,
    value => value.probeLog = value.probeLog.replaceAll('v24.22.1','v24.22.3'),
    value => value.probeLog = value.probeLog.replace('"privateIndexInImage":false','"privateIndexInImage":true'),
    value => value.probeLog = value.probeLog.replace('"actualHeapBytes":524288000','"actualHeapBytes":4294967296'),
    value => value.probeLog += '\n' + value.probeLog,
    value => delete value.resourceFiles['home-bootstrap.mjs']]) {
    const value = fixture(); change(value); assert.throws(() => imageBuildReceipt(value), /home_(image_build|ui)_/);
  }
});

test('the mounted bootstrap actually strips inherited caps before its application child and retains other options', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'home-bootstrap-'));
  try {
    for (const [target, source] of Object.entries(RESOURCE_FILES)) {
      await fs.mkdir(path.dirname(path.join(directory, target)), {recursive:true});
      await fs.copyFile(path.join(root, source), path.join(directory, target));
    }
    const app = path.join(directory, 'app.mjs');
    await fs.writeFile(app, `console.log(JSON.stringify({stage:'synthetic_app',options:process.env.NODE_OPTIONS,
      inheritedPresent:'AVTOCENA_HOME_INHERITED_NODE_OPTIONS' in process.env,args:process.execArgv}));`);
    const bootstrap = path.join(directory, 'home-bootstrap.mjs');
    const original = await fs.readFile(bootstrap, 'utf8');
    assert.equal(original.split("['/app/apps/web/server.js']").length, 2);
    // Only the fixed app path changes in this disposable test copy. Production
    // bootstrap has neither a caller-selected script nor a test-mode override.
    await fs.writeFile(bootstrap, original.replace("['/app/apps/web/server.js']", '[' + JSON.stringify(app) + ']'));
    const env = {...process.env, AVTOCENA_HOME_INHERITED_NODE_OPTIONS:'--max-heap-size=1 --max-old-space-size=6144 --max-semi-space-size=3 --trace-warnings'};
    delete env.NODE_OPTIONS;
    const result = await run(process.execPath, [bootstrap, 'serve'], {env, timeout:30000, maxBuffer:1024*1024});
    const appReceipt = JSON.parse(result.stdout.trim());
    assert.equal(appReceipt.stage, 'synthetic_app');
    assert.equal(appReceipt.inheritedPresent, false);
    assert.deepEqual(parseNodeOptions(appReceipt.options), ['--trace-warnings']);
    assert.equal(appReceipt.args.filter(value => value.startsWith('--max-heap-size=')).length, 1);
    assert.ok(!appReceipt.args.some(value => /max-old-space|max-semi-space/.test(value)));
    const startup = result.stderr.split('\n').filter(Boolean).map(line => JSON.parse(line)).find(row => row.stage === 'node_resource_memory');
    assert.equal(startup.requestedHeapBytes, startup.actualHeapBytes);
    assert.equal(startup.actualHeapBytes, Math.floor((startup.availableRamBytes + startup.usableSwapBytes) / 1048576) * 1048576);
    await assert.rejects(run(process.execPath, [bootstrap, 'serve'], {env:{...env,NODE_OPTIONS:'--trace-warnings'}}), /home_bootstrap_node_options_not_detached/);
    await assert.rejects(run(process.execPath, [bootstrap, 'serve','foreign-script'], {env}), /home_bootstrap_mode/);
  } finally { await fs.rm(directory, {recursive:true, force:true}); }
});

test('image-build marker remains exact-main single-commit scope and cannot reuse the inventory operation', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'home-build-entry-'));
  const git = async args => (await run('git', ['-c','user.name=Build test','-c','user.email=build-test@example.invalid',...args], {cwd:directory})).stdout.trim();
  try {
    await git(['init','-q','--initial-branch=main']);
    await fs.writeFile(path.join(directory, 'controller.txt'), 'synthetic accepted controller\n');
    await git(['add','--all']); await git(['commit','-qm','accepted controller']);
    const parent = await git(['rev-parse','HEAD']);
    await fs.mkdir(path.dirname(path.join(directory, IMAGE_MARKER)), {recursive:true});
    await fs.writeFile(path.join(directory, IMAGE_MARKER), JSON.stringify({version:1, operation:IMAGE_OPERATION, approvedSourceSha:parent}) + '\n');
    await git(['add','--all']); await git(['commit','-qm','single build marker']);
    const head = await git(['rev-parse','HEAD']);
    const eventPath = path.join(directory, '.git/event.json');
    await fs.writeFile(eventPath, JSON.stringify({before:parent,after:head,ref:'refs/heads/main',forced:false,created:false,deleted:false}));
    const env = {GITHUB_REPOSITORY:'jeep-jim/AvtoCena',GITHUB_REPOSITORY_ID:'1289722938',GITHUB_REF:'refs/heads/main',
      GITHUB_SHA:head,GITHUB_EVENT_NAME:'push',GITHUB_RUN_ATTEMPT:'1',GITHUB_EVENT_PATH:eventPath};
    assert.doesNotThrow(() => checkBuildInvocation(directory, env));
    for (const changes of [{GITHUB_REF:'refs/heads/foreign'},{GITHUB_RUN_ATTEMPT:'2'}]) assert.throws(() => checkBuildInvocation(directory,{...env,...changes}));
    await git(['reset','--hard',parent]);
    await fs.mkdir(path.dirname(path.join(directory, IMAGE_MARKER)), {recursive:true});
    await fs.writeFile(path.join(directory, IMAGE_MARKER), JSON.stringify({version:1,operation:'read-home-ui-runtime-20261123',approvedSourceSha:parent}));
    await git(['add','--all']); await git(['commit','-qm','wrong operation']);
    const wrong = await git(['rev-parse','HEAD']);
    await fs.writeFile(eventPath, JSON.stringify({before:parent,after:wrong,ref:'refs/heads/main',forced:false,created:false,deleted:false}));
    assert.throws(() => checkBuildInvocation(directory,{...env,GITHUB_SHA:wrong}), /readonly_invocation_/);
  } finally { await fs.rm(directory, {recursive:true, force:true}); }
});

test('build workflow has no runtime transport or private artifact and mandatory CI retains the original gates', async () => {
  const workflow = await fs.readFile(path.join(root, '.github/workflows/home-ui-image-build.yml'), 'utf8');
  assert.match(workflow, /github\.repository_id == '1289722938'/);
  assert.match(workflow, /github\.run_attempt == '1'/);
  assert.ok(workflow.includes(IMAGE_MARKER));
  assert.match(workflow, /ref: 18e81af30cb9187b139924217a777de1c9819bca/);
  assert.match(workflow, /git fetch --no-write-fetch-head --depth=1 origin 22867cbcfaee27b2e8917b6bf880e44827f67b60/);
  assert.doesNotMatch(workflow, /secrets\.|SSH|scp|contents: write|actions: write|schedule:|catalog-publish|regcloud-deploy/);
  assert.match(workflow, /path: \$\{\{ runner.temp \}\}\/home-ui-image-catalog-18e8\/receipt\.json/);
  const cli = await fs.readFile(path.join(root, '.github/operations/home-ui-adapter-20261123/build-image.mjs'), 'utf8');
  assert.match(cli, /--host=unix:\/\/\/var\/run\/docker\.sock/);
  assert.match(cli, /'archive','--format=tar'/);
  assert.doesNotMatch(cli, /--build-arg|--memory=|--cpus=|docker push|scp|ssh /);
  const ci = await fs.readFile(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  assert.ok(ci.indexOf('tests/home-ui-image-build.test.mjs') > ci.indexOf('node scripts/verify-frozen-speed-baselines.mjs'));
});
