import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {constants, createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash, randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {verifyServingCompatibility} from './serving-compatibility.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const need = (condition, code) => assert(condition, 'china_image_' + code);
const hash = raw => createHash('sha256').update(raw).digest('hex');
const sha40 = value => /^[a-f0-9]{40}$/.test(value ?? '');
const sha64 = value => /^[a-f0-9]{64}$/.test(value ?? '');
const imageId = value => /^sha256:[a-f0-9]{64}$/.test(value ?? '');
const systemPath = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const protectedPaths = ['packages/engine', 'apps/web/lib/encyclopedia', 'apps/web/app/(crm)',
  'apps/web/components/site', 'data', 'apps/web/lib/business-settings.ts'];

// No inherited storage credentials, Docker context, proxy/build arguments or
// user-selected daemon are passed to a child. Build output contains public
// committed sources only; all other commands return bounded stdout separately
// from stderr so a Docker warning cannot alter the inspected JSON.
export async function executeImageCommand(command, args, {
  cwd, env = {PATH: systemPath}, log = false, maximum = 8 * 1024 ** 2,
  timeoutMs = 120000,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {cwd, env, stdio: ['ignore', 'pipe', 'pipe']});
    const stdout = [];
    let bytes = 0, failed = false, killTimer;
    const stop = () => {
      failed = true;
      child.kill('SIGTERM');
      killTimer ??= setTimeout(() => child.kill('SIGKILL'), 5000);
      killTimer.unref();
    };
    const timer = setTimeout(stop, timeoutMs);
    for (const [stream, isStdout] of [[child.stdout, true], [child.stderr, false]]) {
      stream.on('data', raw => {
        if (log) (isStdout ? process.stdout : process.stderr).write(raw);
        else {
          bytes += raw.length;
          if (bytes > maximum) stop();
          else if (isStdout) stdout.push(raw);
        }
      });
    }
    child.once('error', () => {
      clearTimeout(timer); clearTimeout(killTimer);
      reject(Error('china_image_command_start'));
    });
    child.once('close', code => {
      clearTimeout(timer); clearTimeout(killTimer);
      if (code === 0 && !failed) resolve(Buffer.concat(stdout));
      else reject(Error('china_image_command_failed'));
    });
  });
}

function json(raw, code) {
  try { return JSON.parse(String(raw)); }
  catch { throw Error('china_image_' + code); }
}

export async function verifyChinaImageRuntime({runtimeRoot, plan, execute = executeImageCommand}) {
  need(plan?.version === 1 && plan.market === 'china' && sha40(plan.runtimeSha) && sha40(plan.runtimeTree)
    && sha40(plan.retainedRuntime) && sha64(plan.runtimeDiffSha256), 'runtime_plan');
  need(Array.isArray(plan.runtimeFiles) && plan.runtimeFiles.length > 0
    && new Set(plan.runtimeFiles).size === plan.runtimeFiles.length
    && plan.runtimeFiles.every(name => typeof name === 'string' && name.length > 0
      && !name.startsWith('/') && !name.split('/').some(part => ['.', '..', ''].includes(part))
      && !/[\x00-\x1f\x7f\\]/.test(name)), 'runtime_file_list');
  const sourceRoot = await fs.realpath(runtimeRoot);
  const git = args => execute('/usr/bin/git', ['--no-optional-locks', ...args],
    {cwd: sourceRoot, maximum: 32 * 1024 ** 2});
  need(String(await git(['rev-parse', '--show-toplevel'])).trim() === sourceRoot, 'runtime_root');
  need(String(await git(['rev-parse', 'HEAD'])).trim() === plan.runtimeSha, 'runtime_commit');
  need(String(await git(['rev-parse', 'HEAD^{tree}'])).trim() === plan.runtimeTree, 'runtime_tree');
  await git(['diff', '--quiet', '--no-ext-diff', 'HEAD', '--']);
  await git(['merge-base', '--is-ancestor', plan.retainedRuntime, plan.runtimeSha]);
  const changed = String(await git(['diff', '--name-only', '-z', '--no-renames',
    plan.retainedRuntime, plan.runtimeSha])).split('\0').filter(Boolean).sort();
  need(JSON.stringify(changed) === JSON.stringify([...plan.runtimeFiles].sort()), 'runtime_scope');
  const difference = await git(['diff', '--binary', '--full-index', '--no-ext-diff', '--no-renames',
    plan.retainedRuntime, plan.runtimeSha]);
  need(hash(difference) === plan.runtimeDiffSha256, 'runtime_diff');
  await git(['diff', '--quiet', '--no-ext-diff', plan.retainedRuntime, plan.runtimeSha, '--', ...protectedPaths]);
  return {runtimeSha: plan.runtimeSha, runtimeTree: plan.runtimeTree,
    retainedRuntime: plan.retainedRuntime, runtimeDiffSha256: plan.runtimeDiffSha256,
    runtimeFiles: changed, protectedPathsUnchanged: true};
}

export function verifyChinaImageBuilder(info) {
  need(info?.ServerVersion === '29.1.3' && info.Driver === 'overlayfs'
    && Array.isArray(info.DriverStatus) && info.DriverStatus.some(row =>
      Array.isArray(row) && row[0] === 'driver-type' && row[1] === 'io.containerd.snapshotter.v1'), 'builder_store');
  return {version: info.ServerVersion, driver: info.Driver, driverType: 'io.containerd.snapshotter.v1'};
}

export function verifyChinaImageInspection(inspection, runtimeSha) {
  need(imageId(inspection?.Id) && inspection.Descriptor?.digest === inspection.Id
    && inspection.Os === 'linux' && inspection.Architecture === 'amd64'
    && Number.isSafeInteger(inspection.Size) && inspection.Size > 0, 'image_identity');
  const config = inspection.Config;
  need(config && config.Labels?.['org.opencontainers.image.revision'] === runtimeSha
    && config.Labels?.['org.opencontainers.image.source'] === 'https://github.com/jeep-jim/AvtoCena'
    && config.Labels?.['avtocena.application'] === 'web', 'image_config');
  need(Array.isArray(inspection.RootFS?.Layers) && inspection.RootFS.Layers.length > 0
    && inspection.RootFS.Layers.every(imageId), 'image_layers');
  return {imageId: inspection.Id, imageUnpackedBytes: inspection.Size,
    configSha256: hash(JSON.stringify(config)), rootFsSha256: hash(JSON.stringify(inspection.RootFS)),
    platform: 'linux/amd64'};
}

async function fileSeal(filename) {
  const before = await fs.lstat(filename);
  need(before.isFile() && before.nlink === 1 && !before.isSymbolicLink(), 'regular_file');
  const digest = createHash('sha256');
  for await (const raw of createReadStream(filename, {flags: constants.O_RDONLY | constants.O_NOFOLLOW})) digest.update(raw);
  const after = await fs.lstat(filename);
  need(after.isFile() && before.size === after.size && before.ino === after.ino
    && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs, 'file_changed');
  return {bytes: after.size, sha256: digest.digest('hex')};
}

async function assertNoPrivateBuildInput(context) {
  for (const prefix of ['', 'apps/web/', 'apps/bot/']) {
    for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
      try { await fs.lstat(path.join(context, prefix + name)); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      throw Error('china_image_private_input');
    }
  }
  try { await fs.lstat(path.join(context, 'data/knowledge/encyclopedia/calculation-v1.json')); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw Error('china_image_private_input');
}

export async function buildChinaReleaseImage({runtimeRoot, plan, pricingPlan, runnerTemp, dockerHost,
  execute = executeImageCommand, onProgress = () => {}}) {
  const temporary = await fs.realpath(runnerTemp);
  need(path.isAbsolute(temporary) && temporary !== path.parse(temporary).root, 'runner_temp');
  need(typeof dockerHost === 'string' && dockerHost.startsWith('unix:///'), 'builder_socket');
  const socketPath = dockerHost.slice('unix://'.length);
  need(socketPath.startsWith(temporary + path.sep) && socketPath === path.resolve(socketPath)
    && await fs.realpath(socketPath) === socketPath && (await fs.lstat(socketPath)).isSocket(), 'builder_socket');
  const proof = await verifyChinaImageRuntime({runtimeRoot, plan, execute});
  const servingCompatibility = await verifyServingCompatibility({runtimeRoot, servingPlan: plan, pricingPlan});
  const directory = path.join(temporary, 'china-release-build');
  await fs.mkdir(directory, {mode: 0o700}); // A previous completed or incomplete build is never overwritten.
  const context = path.join(directory, 'context');
  const dockerConfig = path.join(directory, 'docker-config');
  const archive = path.join(directory, 'source.tar');
  const image = path.join(directory, 'image.tar');
  const env = {PATH: systemPath, DOCKER_CONFIG: dockerConfig, DOCKER_HOST: dockerHost, DOCKER_BUILDKIT: '1'};
  const docker = (args, options = {}) => execute('/usr/bin/docker', ['--host=' + dockerHost, ...args], {...options, env});
  try {
    for (const folder of [context, dockerConfig]) await fs.mkdir(folder, {mode: 0o700});
    const builder = verifyChinaImageBuilder(json(await docker(['info', '--format', '{{json .}}']), 'builder_json'));
    onProgress({phase: 'china_image_source', runtimeSha: proof.runtimeSha});
    await execute('/usr/bin/git', ['-C', runtimeRoot, 'archive', '--format=tar', '--output=' + archive, plan.runtimeSha]);
    await execute('/usr/bin/tar', ['--extract', '--file', archive, '--directory', context, '--no-same-owner']);
    await assertNoPrivateBuildInput(context);
    await verifyChinaImageRuntime({runtimeRoot, plan, execute});
    await verifyServingCompatibility({runtimeRoot, servingPlan: plan, pricingPlan});
    const sourceArchive = await fileSeal(archive);
    const tag = 'avtocena-china-runtime:' + plan.runtimeSha + '-' + randomBytes(6).toString('hex');
    onProgress({phase: 'china_image_build', runtimeSha: proof.runtimeSha});
    await docker(['build', '--pull', '--platform=linux/amd64', '--provenance=false', '--sbom=false',
      '--label', 'org.opencontainers.image.revision=' + plan.runtimeSha,
      '--label', 'org.opencontainers.image.source=https://github.com/jeep-jim/AvtoCena',
      '--label', 'avtocena.application=web', '--tag', tag, context], {log: true, timeoutMs: 3600000});
    const inspect = async reference => json(await docker(['image', 'inspect', '--format', '{{json .}}', reference]), 'inspect_json');
    const inspected = verifyChinaImageInspection(await inspect(tag), plan.runtimeSha);
    await verifyChinaImageRuntime({runtimeRoot, plan, execute});
    onProgress({phase: 'china_image_archive_roundtrip', imageId: inspected.imageId});
    // Keep the saved OCI descriptor intact: selecting a platform during export
    // can rewrite an index. The build itself is exclusively linux/amd64.
    await docker(['image', 'save', '--output', image, tag], {timeoutMs: 900000});
    need(JSON.stringify(verifyChinaImageInspection(await inspect(tag), plan.runtimeSha)) === JSON.stringify(inspected), 'export_changed');
    const archiveSeal = await fileSeal(image);
    need(archiveSeal.bytes > 0, 'empty_archive');
    // Only this fresh image in the explicitly isolated daemon is removed. No
    // force, prune, container run, host contact or application activation.
    await docker(['image', 'rm', inspected.imageId]);
    await docker(['image', 'load', '--input', image], {timeoutMs: 900000});
    const restored = verifyChinaImageInspection(await inspect(inspected.imageId), plan.runtimeSha);
    need(JSON.stringify(restored) === JSON.stringify(inspected), 'archive_roundtrip');
    need(JSON.stringify(await fileSeal(image)) === JSON.stringify(archiveSeal), 'archive_changed');
    await verifyChinaImageRuntime({runtimeRoot, plan, execute});
    const receipt = {version: 1, kind: 'china-runtime-image-v1', market: 'china',
      ...proof, ...inspected, ...archiveSeal, builder, sourceArchive, servingCompatibility,
      pricingRuntimeSha: pricingPlan.runtimeSha, pricingRuntimeTree: pricingPlan.runtimeTree,
      archiveRoundTripVerified: true, activationAuthorized: false,
      hostContacted: false, privateDataIncluded: false};
    await fs.chmod(image, 0o400);
    await fs.writeFile(path.join(directory, 'image-receipt.json'), JSON.stringify(receipt, null, 2) + '\n',
      {mode: 0o400, flag: 'wx'});
    onProgress({phase: 'china_image_ready', runtimeSha: receipt.runtimeSha, imageId: receipt.imageId,
      bytes: receipt.bytes, sha256: receipt.sha256, hostContacted: false});
    return receipt;
  } finally {
    // These paths were created by this invocation under its private output.
    // Preserve only the image/receipt; never clear any daemon or other stage.
    for (const filename of [context, archive, dockerConfig]) await fs.rm(filename, {recursive: true, force: true});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    need(process.argv.length === 3, 'arguments');
    const plan = JSON.parse(await fs.readFile(path.join(root, '.github/operations/catalog-next/china-serving-plan.json'), 'utf8'));
    const pricingPlan = JSON.parse(await fs.readFile(path.join(root, '.github/operations/catalog-next/china-plan.json'), 'utf8'));
    await buildChinaReleaseImage({runtimeRoot: path.resolve(process.argv[2]), plan, pricingPlan,
      runnerTemp: process.env.RUNNER_TEMP, dockerHost: process.env.CHINA_BUILD_DOCKER_HOST,
      onProgress: value => console.log(JSON.stringify(value))});
  } catch (error) {
    console.error(/^china_image_[a-z_]+$/.test(error?.message ?? '') ? error.message : 'china_image_build_failed');
    process.exitCode = 1;
  }
}
