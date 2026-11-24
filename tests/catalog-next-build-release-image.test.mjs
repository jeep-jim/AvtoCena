import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {buildChinaReleaseImage, executeImageCommand, verifyChinaImageBuilder,
  verifyChinaImageRuntime} from '../scripts/catalog-next/build-release-image.mjs';

const hash = raw => createHash('sha256').update(raw).digest('hex');
const validBuilder = {ServerVersion: '29.1.3', Driver: 'overlayfs',
  DriverStatus: [['driver-type', 'io.containerd.snapshotter.v1']]};
const absent = filename => assert.rejects(fs.lstat(filename), {code: 'ENOENT'});

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'china-image-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const runtimeRoot = path.join(directory, 'runtime');
  const runnerTemp = path.join(directory, 'runner');
  await fs.mkdir(runtimeRoot); await fs.mkdir(runnerTemp);
  const git = args => execFileSync('/usr/bin/git', args,
    {cwd: runtimeRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  const commit = () => {
    git(['add', '.']);
    git(['-c', 'user.email=fixture@example.invalid', '-c', 'user.name=Fixture',
      'commit', '--no-gpg-sign', '-m', 'fixture']);
  };
  git(['init', '--quiet']);
  await fs.writeFile(path.join(runtimeRoot, 'Dockerfile'), 'FROM scratch\nCMD ["/app"]\n');
  await fs.writeFile(path.join(runtimeRoot, 'public.mjs'), 'export const publicValue = 1;\n');
  commit();
  const retainedRuntime = git(['rev-parse', 'HEAD']).trim();
  await fs.writeFile(path.join(runtimeRoot, 'public.mjs'), 'export const publicValue = 2;\n');
  commit();
  const plan = () => {
    const runtimeSha = git(['rev-parse', 'HEAD']).trim(), runtimeTree = git(['rev-parse', 'HEAD^{tree}']).trim();
    return {version: 1, market: 'china', minimumYear: 2014, retainedRuntime, runtimeSha, runtimeTree,
      pricingRuntimeSha: runtimeSha, pricingRuntimeTree: runtimeTree, pricingToServingDiffSha256: hash(''), pricingToServingFiles: [],
      runtimeDiffSha256: hash(git(['diff', '--binary', '--full-index', '--no-ext-diff', '--no-renames', retainedRuntime, 'HEAD'])),
      runtimeFiles: git(['diff', '--name-only', '--no-renames', retainedRuntime, 'HEAD']).trim().split('\n')};
  };
  const socket = path.join(runnerTemp, 'daemon.sock');
  // This unit environment cannot bind sockets. Simulate only this inode's
  // socket type; realpath containment/symlink checks and all Git/tar/files are
  // real. No production bypass or actual Docker daemon is used by these tests.
  await fs.writeFile(socket, 'fake Docker socket');
  const realLstat = fs.lstat.bind(fs);
  t.mock.method(fs, 'lstat', async (filename, ...args) => {
    const metadata = await realLstat(filename, ...args);
    return String(filename) === socket ? {isSocket: () => true} : metadata;
  });
  return {directory, runtimeRoot, runnerTemp, git, commit, plan,
    options: {runtimeRoot, runnerTemp, plan: plan(), pricingPlan: plan(), dockerHost: 'unix://' + socket}};
}

function fakeDocker(f, {builder = validBuilder, onBuild, onLoad, changeRestoredId = false} = {}) {
  const calls = [];
  const inspection = {Id: 'sha256:' + 'a'.repeat(64), Descriptor: {digest: 'sha256:' + 'a'.repeat(64)},
    Os: 'linux', Architecture: 'amd64', Size: 8192,
    RootFS: {Type: 'layers', Layers: ['sha256:' + 'b'.repeat(64)]},
    Config: {WorkingDir: '/app', Entrypoint: ['existing-bootstrap'], Cmd: ['unchanged-command'],
      Labels: {'org.opencontainers.image.revision': f.options.plan.runtimeSha,
        'org.opencontainers.image.source': 'https://github.com/jeep-jim/AvtoCena', 'avtocena.application': 'web'}}};
  let image, removed = false, loaded = false;
  return {calls, inspection, execute: async (command, originalArgs, options) => {
    if (command !== '/usr/bin/docker') return executeImageCommand(command, originalArgs, options);
    assert.equal(originalArgs[0], '--host=' + f.options.dockerHost);
    assert.deepEqual(Object.keys(options.env).sort(), ['DOCKER_BUILDKIT', 'DOCKER_CONFIG', 'DOCKER_HOST', 'PATH']);
    assert.equal(options.env.DOCKER_HOST, f.options.dockerHost);
    const args = originalArgs.slice(1); calls.push(args);
    if (args[0] === 'info') return Buffer.from(JSON.stringify(builder));
    if (args[0] === 'build') {
      const context = args.at(-1);
      assert.equal(await fs.readFile(path.join(context, 'public.mjs'), 'utf8'), 'export const publicValue = 2;\n');
      await absent(path.join(context, '.git'));
      await absent(path.join(context, '.env.local'));
      await absent(path.join(context, 'resources'));
      assert(args.includes('--platform=linux/amd64'));
      assert(args.includes('--provenance=false'));
      assert(args.includes('--sbom=false'));
      assert(!args.some(arg => /build-arg|secret|ssh|volume|mount|network=host/.test(arg)));
      await onBuild?.(context);
      return Buffer.alloc(0);
    }
    if (args[0] === 'image' && args[1] === 'inspect') {
      if (removed) assert(loaded, 'the image must really be loaded after removal before inspect succeeds');
      return Buffer.from(JSON.stringify(loaded && changeRestoredId
        ? {...inspection, Id: 'sha256:' + 'c'.repeat(64), Descriptor: {digest: 'sha256:' + 'c'.repeat(64)}} : inspection));
    }
    if (args[0] === 'image' && args[1] === 'save') {
      image = args[args.indexOf('--output') + 1];
      await fs.writeFile(image, 'fixture image bytes whose SHA must remain unchanged\n', {flag: 'wx'});
      return Buffer.alloc(0);
    }
    if (args[0] === 'image' && args[1] === 'rm') {
      assert.deepEqual(args, ['image', 'rm', inspection.Id]);
      assert(image); removed = true;
      return Buffer.alloc(0);
    }
    if (args[0] === 'image' && args[1] === 'load') {
      assert(removed); assert.equal(args[args.indexOf('--input') + 1], image);
      loaded = true; await onLoad?.(image, inspection);
      return Buffer.alloc(0);
    }
    assert.fail('unexpected Docker operation: ' + args.join(' '));
  }};
}

test('exact committed source builds a sealed image receipt only after save/remove/load identity check', async t => {
  const f = await fixture(t);
  // Neither an untracked secret nor the calling process's environment is a build input.
  await fs.writeFile(path.join(f.runtimeRoot, '.env.local'), 'A_REAL_SECRET_MUST_NOT_BE_COPIED=fixture\n');
  const docker = fakeDocker(f), progress = [];
  const result = await buildChinaReleaseImage({...f.options, execute: docker.execute, onProgress: value => progress.push(value)});
  const output = path.join(f.runnerTemp, 'china-release-build');
  const image = await fs.readFile(path.join(output, 'image.tar'));
  assert.equal(result.sha256, hash(image)); assert.equal(result.bytes, image.length);
  assert.equal(result.runtimeSha, f.options.plan.runtimeSha); assert.equal(result.runtimeTree, f.options.plan.runtimeTree);
  assert.equal(result.runtimeDiffSha256, f.options.plan.runtimeDiffSha256);
  assert.equal(result.imageId, docker.inspection.Id); assert.equal(result.archiveRoundTripVerified, true);
  assert.equal(result.configSha256, hash(JSON.stringify(docker.inspection.Config)));
  assert.equal(result.pricingRuntimeSha, f.options.pricingPlan.runtimeSha);
  assert.equal(result.servingCompatibility.protectedPricingPathsUnchanged, true);
  assert.equal(result.hostContacted, false); assert.equal(result.activationAuthorized, false);
  assert.deepEqual(result.builder, {version: '29.1.3', driver: 'overlayfs', driverType: 'io.containerd.snapshotter.v1'});
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(output, 'image-receipt.json'), 'utf8')), result);
  assert.equal((await fs.stat(path.join(output, 'image.tar'))).mode & 0o777, 0o400);
  assert.deepEqual((await fs.readdir(output)).sort(), ['image-receipt.json', 'image.tar']);
  assert.equal(progress.at(-1).phase, 'china_image_ready');
  assert.equal(docker.calls.filter(args => args[1] === 'rm').length, 1);
  assert.equal(docker.calls.filter(args => args[1] === 'load').length, 1);
});

test('a wrong source commit, tree, diff or file scope cannot produce an image', async t => {
  const f = await fixture(t);
  for (const change of [{runtimeSha: '0'.repeat(40)}, {runtimeTree: '0'.repeat(40)},
    {runtimeDiffSha256: '0'.repeat(64)}, {runtimeFiles: ['unreviewed.mjs']},
    {runtimeFiles: ['../escape']}, {runtimeFiles: ['public.mjs', 'public.mjs']}]) {
    await assert.rejects(verifyChinaImageRuntime({runtimeRoot: f.runtimeRoot, plan: {...f.options.plan, ...change}}), /china_image_/);
  }
  await absent(path.join(f.runnerTemp, 'china-release-build'));
});

test('canonical image source verifies across short and full Git abbreviations without changing source', async t => {
  const f = await fixture(t);
  const source = f.git(['ls-files', '--stage']);
  f.git(['config', 'core.abbrev', '7']);
  const plan = f.plan();
  const abbreviated = hash(f.git(['diff', '--binary', '--no-ext-diff', '--no-renames',
    plan.retainedRuntime, plan.runtimeSha]));
  assert.notEqual(abbreviated, plan.runtimeDiffSha256);
  for (const abbreviation of ['40', '7']) {
    f.git(['config', 'core.abbrev', abbreviation]);
    assert.deepEqual(f.plan(), plan);
    const proof = await verifyChinaImageRuntime({runtimeRoot: f.runtimeRoot, plan});
    assert.equal(proof.runtimeDiffSha256, plan.runtimeDiffSha256);
    assert.deepEqual(proof.runtimeFiles, plan.runtimeFiles);
    await assert.rejects(verifyChinaImageRuntime({runtimeRoot: f.runtimeRoot,
      plan: {...plan, runtimeDiffSha256: abbreviated}}), /china_image_runtime_diff/);
    assert.equal(f.git(['ls-files', '--stage']), source);
    assert.equal(f.git(['status', '--porcelain']), '');
  }
});

test('changed image source bytes in the same files cannot reuse a reviewed canonical digest', async t => {
  const f = await fixture(t);
  f.git(['config', 'core.abbrev', '7']);
  const reviewed = f.plan();
  await fs.writeFile(path.join(f.runtimeRoot, 'public.mjs'), 'export const publicValue = 3;\n'); f.commit();
  f.git(['config', 'core.abbrev', '40']);
  const changed = f.plan();
  assert.deepEqual(changed.runtimeFiles, reviewed.runtimeFiles);
  assert.notEqual(changed.runtimeSha, reviewed.runtimeSha);
  assert.notEqual(changed.runtimeTree, reviewed.runtimeTree);
  assert.notEqual(changed.runtimeDiffSha256, reviewed.runtimeDiffSha256);
  await assert.rejects(verifyChinaImageRuntime({runtimeRoot: f.runtimeRoot,
    plan: {...changed, runtimeDiffSha256: reviewed.runtimeDiffSha256}}), /china_image_runtime_diff/);
});

test('a tracked local edit is refused before any Docker command', async t => {
  const f = await fixture(t), docker = fakeDocker(f);
  await fs.writeFile(path.join(f.runtimeRoot, 'public.mjs'), 'changed after review\n');
  await assert.rejects(buildChinaReleaseImage({...f.options, execute: docker.execute}), /china_image_command_failed/);
  assert.equal(docker.calls.length, 0);
  await absent(path.join(f.runnerTemp, 'china-release-build'));
});

test('an exact diff still cannot contain formula, encyclopedia, admin or settings changes', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.runtimeRoot, 'packages/engine'), {recursive: true});
  await fs.writeFile(path.join(f.runtimeRoot, 'packages/engine/formula.js'), 'changed formula\n');
  f.commit();
  await assert.rejects(verifyChinaImageRuntime({runtimeRoot: f.runtimeRoot, plan: f.plan()}), /china_image_command_failed/);
});

test('default, remote and symlinked Docker daemons are refused', async t => {
  const f = await fixture(t), docker = fakeDocker(f);
  const link = path.join(f.runnerTemp, 'alias.sock');
  await fs.symlink(f.options.dockerHost.slice('unix://'.length), link);
  for (const host of [undefined, 'tcp://localhost:2375', 'unix:///var/run/docker.sock', 'unix://' + link]) {
    await assert.rejects(buildChinaReleaseImage({...f.options, dockerHost: host, execute: docker.execute}), /china_image_builder_socket/);
  }
  assert.equal(docker.calls.length, 0);
});

test('classic image store and an unpinned Docker version are refused', () => {
  for (const builder of [{...validBuilder, Driver: 'overlay2'}, {...validBuilder, ServerVersion: '28.5.2'},
    {...validBuilder, DriverStatus: []}]) assert.throws(() => verifyChinaImageBuilder(builder), /china_image_builder_store/);
});

test('different image identity after load leaves no completed receipt', async t => {
  const f = await fixture(t), docker = fakeDocker(f, {changeRestoredId: true});
  await assert.rejects(buildChinaReleaseImage({...f.options, execute: docker.execute}), /china_image_archive_roundtrip/);
  await absent(path.join(f.runnerTemp, 'china-release-build', 'image-receipt.json'));
});

test('an archive modified during the roundtrip cannot receive a receipt', async t => {
  const f = await fixture(t), docker = fakeDocker(f, {onLoad: image => fs.appendFile(image, 'corrupted')});
  await assert.rejects(buildChinaReleaseImage({...f.options, execute: docker.execute}), /china_image_archive_changed/);
  await absent(path.join(f.runnerTemp, 'china-release-build', 'image-receipt.json'));
});

test('source changed during the build is refused before exporting the image', async t => {
  const f = await fixture(t), docker = fakeDocker(f, {
    onBuild: () => fs.writeFile(path.join(f.runtimeRoot, 'public.mjs'), 'racing edit\n'),
  });
  await assert.rejects(buildChinaReleaseImage({...f.options, execute: docker.execute}), /china_image_command_failed/);
  assert(!docker.calls.some(args => args[1] === 'save'));
  await absent(path.join(f.runnerTemp, 'china-release-build', 'image-receipt.json'));
});

test('a committed private environment file is not allowed into the image context', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.runtimeRoot, '.env.production'), 'PRIVATE_KEY=fixture\n');
  f.commit(); f.options.plan = f.plan(); f.options.pricingPlan = f.plan();
  const docker = fakeDocker(f);
  await assert.rejects(buildChinaReleaseImage({...f.options, execute: docker.execute}), /china_image_private_input/);
  assert(!docker.calls.some(args => args[0] === 'build'));
  await absent(path.join(f.runnerTemp, 'china-release-build', 'image-receipt.json'));
});
