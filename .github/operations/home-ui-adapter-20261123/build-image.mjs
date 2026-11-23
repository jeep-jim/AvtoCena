import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {HOME_UI, sha256, assertHomeSourceEvidence, verifyHomeSourceCheckout, verifyHomeGateFiles} from '../home-ui-only-20261123/contract.mjs';
import {verifyReadonlyInvocation} from '../../../scripts/lib/readonly-marker-invocation.mjs';

export const IMAGE_MARKER = '.github/market-runs/home-ui-image-build.json';
export const IMAGE_OPERATION = 'build-home-ui-image-catalog-a059';
export const RESOURCE_FILES = Object.freeze({
  'home-bootstrap.mjs':'.github/operations/home-ui-adapter-20261123/home-bootstrap.mjs',
  'run-node-with-resources.mjs':'scripts/run-node-with-resources.mjs',
  'lib/node-resource-memory.mjs':'scripts/lib/node-resource-memory.mjs',
  'lib/node-resource-memory-startup.mjs':'scripts/lib/node-resource-memory-startup.mjs',
});
const ASSET = 'ee5c872e9127430890f58abf239cddfa48553f86c3032799c9c29953b6109662';
const need = (value, code) => { if (!value) throw Error('home_image_build_' + code); };
const controllerRoot = fileURLToPath(new URL('../../..', import.meta.url));

export function checkBuildInvocation(root = controllerRoot, env = process.env) {
  return verifyReadonlyInvocation({root, env, markerPath:IMAGE_MARKER, operation:IMAGE_OPERATION});
}

export function imageBuildReceipt({proof, inspection, probeLog, imageArchiveSha256, resourceFiles, controllerSha}) {
  assertHomeSourceEvidence(proof);
  need(/^[a-f0-9]{64}$/.test(imageArchiveSha256 || '') && /^[a-f0-9]{40}$/.test(controllerSha || ''), 'digest');
  need(/^sha256:[a-f0-9]{64}$/.test(inspection?.Id || '') && inspection.Os === 'linux' && inspection.Architecture === 'amd64', 'image_identity');
  need(Number.isSafeInteger(inspection.Size) && inspection.Size > 0, 'image_size');
  const config = inspection.Config;
  need(config?.WorkingDir === '/app' && JSON.stringify(config.Cmd) === JSON.stringify(['node','apps/web/server.js'])
    && config.Labels?.['org.opencontainers.image.revision'] === HOME_UI.source
    && config.Labels?.['org.opencontainers.image.source'] === 'https://github.com/jeep-jim/AvtoCena'
    && config.Labels?.['avtocena.application'] === 'web' && Object.keys(config.Labels).length === 3, 'image_config');
  const records = String(probeLog).split('\n').flatMap(line => {
    try { const row = JSON.parse(line); return row && typeof row === 'object' ? [row] : []; } catch { return []; }
  });
  const memory = records.filter(row => row.stage === 'node_resource_memory'), probes = records.filter(row => row.stage === 'home_image_probe');
  need(memory.length === 1 && probes.length === 1, 'probe_count');
  const resource = memory[0], probe = probes[0];
  need(resource.nodeVersion === 'v24.22.1' && Number.isSafeInteger(resource.actualHeapBytes) && resource.actualHeapBytes > 0
    && resource.actualHeapBytes === resource.requestedHeapBytes
    && Number.isSafeInteger(resource.availableRamBytes) && resource.availableRamBytes >= 0
    && Number.isSafeInteger(resource.usableSwapBytes) && resource.usableSwapBytes >= 0
    && resource.actualHeapBytes === Math.floor((resource.availableRamBytes + resource.usableSwapBytes) / 1048576) * 1048576,
    'resource_probe');
  need(probe.passed === true && probe.nodeVersion === 'v24.22.1' && probe.modelAssetSha256 === ASSET
    && probe.privateIndexInImage === false, 'image_probe');
  need(JSON.stringify(Object.keys(resourceFiles || {}).sort()) === JSON.stringify(Object.keys(RESOURCE_FILES).sort())
    && Object.values(resourceFiles).every(value => /^[a-f0-9]{64}$/.test(value)), 'resource_bundle');
  return {version:1, status:'verified_exact_home_image_build', activationAuthorized:false,
    source:HOME_UI.source, tree:HOME_UI.tree, sourceCalculationVersion:HOME_UI.sourceCalculationVersion,
    intendedServingCalculationVersion:HOME_UI.servingCalculationVersion, imageId:inspection.Id, imageArchiveSha256,
    imageUnpackedBytes:inspection.Size,
    nodeVersion:probe.nodeVersion, modelAssetSha256:ASSET, privateIndexInImage:false,
    resourceProbePassed:true, requestedHeapBytes:resource.requestedHeapBytes, actualHeapBytes:resource.actualHeapBytes,
    resourceFiles, controllerSha, sourceProof:proof, hostContacted:false, runtimeChanged:false,
    imageArchivePublished:false, privateBindingVerified:false, privateServerGatePassed:false, browserGatePassed:false};
}

async function execute(command, args, {cwd, env, log = false} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {cwd, env, stdio:['ignore','pipe','pipe']});
    const buffers = []; let bytes = 0;
    for (const stream of [child.stdout, child.stderr]) stream.on('data', buffer => {
      if (log) process.stdout.write(buffer);
      else { bytes += buffer.length; if (bytes > 8 * 1024 * 1024) child.kill('SIGTERM'); else buffers.push(buffer); }
    });
    child.once('error', () => reject(Error('home_image_build_command_failed')));
    child.once('exit', code => code === 0 && bytes <= 8 * 1024 * 1024
      ? resolve(Buffer.concat(buffers)) : reject(Error('home_image_build_command_failed')));
  });
}

async function fileDigest(filename) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(filename)) digest.update(chunk);
  return digest.digest('hex');
}

/** Ephemeral runner only: build/probe/hash, no SSH, registry push, REG writes or
 * public image artifact. The separate accepted runtime is never contacted. */
async function buildImage(sourceRoot, outputRoot, activation) {
  const checkInvocation = activation ? () => verifyReadonlyInvocation({root:controllerRoot,
    markerPath:'.github/market-runs/home-ui-activation.json', operation:'prepare-home-ui-catalog-a059'}) : checkBuildInvocation;
  const invocation = checkInvocation();
  verifyHomeGateFiles(controllerRoot);
  const proof = verifyHomeSourceCheckout(sourceRoot);
  const runner = await fs.realpath(process.env.RUNNER_TEMP || '');
  need(path.resolve(outputRoot) === path.join(runner, 'home-ui-image-catalog-a059'), 'output_scope');
  await fs.mkdir(outputRoot, {mode:0o700});
  const context = path.join(outputRoot, 'context'), bundle = path.join(outputRoot, 'node-resources');
  for (const directory of [context, bundle, path.join(outputRoot, 'docker-config')]) await fs.mkdir(directory, {mode:0o700});
  const env = {PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    DOCKER_CONFIG:path.join(outputRoot, 'docker-config')};
  const archive = path.join(outputRoot, 'source.tar');
  await execute('/usr/bin/git', ['-C', sourceRoot, 'archive','--format=tar','--output=' + archive,HOME_UI.source], {env});
  await execute('/usr/bin/tar', ['--extract','--file',archive,'--directory',context,'--no-same-owner'], {env});
  for (const name of ['.env','.env.local','.env.production','.env.production.local','data/knowledge/encyclopedia/calculation-v1.json']) {
    let present = false; try { await fs.lstat(path.join(context, name)); present = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    need(!present, 'private_build_input');
  }
  const resourceFiles = {};
  for (const [name, source] of Object.entries(RESOURCE_FILES)) {
    const bytes = await fs.readFile(path.join(controllerRoot, source));
    await fs.mkdir(path.dirname(path.join(bundle, name)), {recursive:true, mode:0o700});
    await fs.writeFile(path.join(bundle, name), bytes, {mode:0o400, flag:'wx'});
    resourceFiles[name] = sha256(bytes);
  }
  const docker = args => execute('/usr/bin/docker', ['--host=unix:///var/run/docker.sock', ...args], {env});
  const tag = 'avtocena-home-build:' + HOME_UI.source;
  checkInvocation();
  await execute('/usr/bin/docker', ['--host=unix:///var/run/docker.sock','build','--pull',
    '--label','org.opencontainers.image.revision=' + HOME_UI.source,
    '--label','org.opencontainers.image.source=https://github.com/jeep-jim/AvtoCena',
    '--label','avtocena.application=web','--tag',tag,context], {env, log:true});
  const inspection = JSON.parse(await docker(['image','inspect','--format','{{json .}}',tag]));
  need(/^sha256:[a-f0-9]{64}$/.test(inspection?.Id || ''), 'built_image_id');
  const probeLog = await docker(['run','--rm','--network','none','--read-only','--entrypoint','node',
    '--env','AVTOCENA_HOME_INHERITED_NODE_OPTIONS=--trace-warnings --max-old-space-size=6144',
    '--mount','type=bind,src=' + bundle + ',dst=/run/avtocena-node-resources,readonly',
    inspection.Id,'/run/avtocena-node-resources/home-bootstrap.mjs','image-probe']);
  const imageArchive = path.join(outputRoot, 'image.tar');
  await docker(['image','save','--output',imageArchive,inspection.Id]);
  const receipt = imageBuildReceipt({proof, inspection, probeLog, imageArchiveSha256:await fileDigest(imageArchive),
    resourceFiles, controllerSha:invocation.headSha || process.env.GITHUB_SHA});
  await fs.writeFile(path.join(outputRoot, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', {mode:0o600, flag:'wx'});
  console.log(JSON.stringify(receipt));
  return receipt;
}

export const buildHomeImage = (sourceRoot, outputRoot) => buildImage(sourceRoot, outputRoot, false);
// Separate, closed entry profile; build-only callers retain their original
// marker/manual checks and cannot publish, contact the VM or bind private data.
export const buildHomeImageForActivation = (sourceRoot, outputRoot) => buildImage(sourceRoot, outputRoot, true);

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === '--check-invocation' && process.argv.length === 3) console.log(JSON.stringify(checkBuildInvocation()));
    else {
      need(process.argv.length === 4, 'arguments');
      await buildHomeImage(path.resolve(process.argv[2]), path.resolve(process.argv[3]));
    }
  } catch (error) {
    // subprocess/private inspection payloads never become an exception receipt.
    console.error(/^home_(?:image_build|ui)_[-a-z0-9_:]+$/.test(error.message || '') ? error.message : 'home_image_build_failed');
    process.exitCode = 1;
  }
}
