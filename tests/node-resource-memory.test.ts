import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createResourceNodeInvocation, forwardResourceNodeTelemetry, parseNodeOptions,
  readNodeMemoryResources, stripNodeMemoryArguments} from '../scripts/lib/node-resource-memory.mjs';

const MIB = 1024 ** 2, GIB = 1024 ** 3, run = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const noSwap = 'SwapTotal: 0 kB\nSwapFree: 0 kB\n';
const swap = `SwapTotal: ${8 * GIB / 1024} kB\nSwapFree: ${6 * GIB / 1024} kB\n`;
const mount = '31 22 0:28 / /sys/fs/cgroup rw,nosuid,nodev,noexec,relatime - cgroup2 cgroup rw\n';
function fakeResources(files:Record<string,string>, overrides:Record<string,unknown> = {}) {
  return {platform:'linux', availableMemory:() => 4 * GIB, constrainedMemory:() => 6 * GIB,
    totalMemory:() => 8 * GIB, readFile:async (name:string) => {
      if (!(name in files)) throw Object.assign(Error('missing synthetic file'), {code:'ENOENT'});
      return files[name];
    }, ...overrides};
}
function cgroupFiles() {
  const files:Record<string,string> = {'/proc/meminfo':swap, '/proc/self/cgroup':'0::/jobs/run\n', '/proc/self/mountinfo':mount};
  for (const [directory, memoryMax, memoryCurrent, swapMax, swapCurrent] of [
    ['/jobs/run', 6 * GIB, GIB, 4 * GIB, GIB], ['/jobs', 4 * GIB, GIB, 2 * GIB, GIB / 2],
  ]) {
    const prefix = '/sys/fs/cgroup' + directory;
    files[prefix + '/memory.max'] = String(memoryMax);
    files[prefix + '/memory.current'] = String(memoryCurrent);
    files[prefix + '/memory.swap.max'] = String(swapMax);
    files[prefix + '/memory.swap.current'] = String(swapCurrent);
  }
  return files;
}
const smallResourceFixture = () => readNodeMemoryResources(fakeResources({'/proc/meminfo':noSwap}, {
  availableMemory:() => 256 * MIB + 1200, constrainedMemory:() => 0, totalMemory:() => GIB,
}));

test('Node options retain their own quoting grammar and strip sizing flags only before the application', () => {
  assert.deepEqual(parseNodeOptions('--require "a b\\\\c\\\"d" --trace-warnings'), ['--require', 'a b\\c"d', '--trace-warnings']);
  assert.deepEqual(parseNodeOptions("--title='two words'"), ["--title='two", "words'"]);
  assert.throws(() => parseNodeOptions('--require "broken'), /unterminated_quote/);
  assert.throws(() => parseNodeOptions('--require "broken\\'), /unterminated_escape/);
  assert.deepEqual(stripNodeMemoryArguments(['--max_old_space_size=12288', '--trace-warnings', '--max-semi-space-size', '64',
    '--import', 'tsx', '--max-old-space-size-percentage=100', '--max-heap-size', '9999',
    'job.mjs', '--max-old-space-size=42']), ['--trace-warnings', '--import', 'tsx', 'job.mjs', '--max-old-space-size=42']);
  assert.deepEqual(stripNodeMemoryArguments(['--max_heap_size=4096', '--', 'job.mjs', '--max-heap-size=8']),
    ['--', 'job.mjs', '--max-heap-size=8']);
  assert.deepEqual(stripNodeMemoryArguments(['--require', '--max-heap-size=module-name'], {environment:true}),
    ['--require', '--max-heap-size=module-name']);
  assert.throws(() => stripNodeMemoryArguments(['--max-old-space-size', '--trace-warnings']), /memory_option_invalid/);
});

test('resource plan counts only actual free swap allowed by every cgroup ancestor', async () => {
  const resources = await readNodeMemoryResources(fakeResources(cgroupFiles()));
  assert.equal(resources.availableRamBytes, 3 * GIB);
  assert.equal(resources.observedSwapFreeBytes, 6 * GIB);
  assert.equal(resources.usableSwapBytes, 1.5 * GIB);
  assert.equal(resources.cgroupMemoryHeadroomBytes, 3 * GIB);
  assert.equal(resources.cgroupSwapHeadroomBytes, 1.5 * GIB);
  assert.equal(resources.cgroupScopes, 2);
  assert.equal(resources.swapReason, 'cgroup_v2_verified');
  const invocation = await createResourceNodeInvocation({args:['job.mjs'], env:{}, readResources:async () => resources});
  assert.equal(invocation.plan.heapMiB, 4608);
  assert.equal(invocation.plan.capacityBytes, 4.5 * GIB);
  assert.equal(invocation.args[0], '--max-heap-size=4608');
});

test('unlimited swap still uses SwapFree, and exhausted or unverified cgroups never grant swap', async () => {
  const unlimited = cgroupFiles();
  for (const name of Object.keys(unlimited).filter(name => name.endsWith('.max'))) unlimited[name] = 'max';
  assert.equal((await readNodeMemoryResources(fakeResources(unlimited))).usableSwapBytes, 6 * GIB);
  const exhausted = cgroupFiles();
  exhausted['/sys/fs/cgroup/jobs/memory.swap.max'] = '0';
  const exhaustedResult = await readNodeMemoryResources(fakeResources(exhausted));
  assert.equal(exhaustedResult.usableSwapBytes, 0);
  assert.equal(exhaustedResult.swapReason, 'cgroup_swap_exhausted');
  const cases:Array<[string,(files:Record<string,string>) => void]> = [
    ['cgroup_v1_memory_unverified', files => { files['/proc/self/cgroup'] = '5:memory:/jobs/run\n'; }],
    ['cgroup_v2_mount_unverified', files => { files['/proc/self/mountinfo'] = mount.replace(' / /sys/', ' /hidden /sys/'); }],
    ['cgroup_v2_mount_unverified', files => { files['/proc/self/mountinfo'] = ''; }],
    ['cgroup_v2_root_scope_unverified', files => { files['/proc/self/cgroup'] = '0::/\n'; }],
    ['cgroup_v2_root_scope_unverified', files => {
      for (const name of ['memory.max', 'memory.current', 'memory.swap.max', 'memory.swap.current']) {
        files['/sys/fs/cgroup/' + name] = name.endsWith('.max') ? 'max' : '0';
      }
    }],
    ['cgroup_v2_accounting_unverified', files => { delete files['/sys/fs/cgroup/jobs/memory.swap.current']; }],
    ['cgroup_v2_accounting_unverified', files => { files['/sys/fs/cgroup/jobs/memory.current'] = 'wrong'; }],
    ['proc_swap_unverified', files => { files['/proc/meminfo'] = 'SwapFree: 999 kB\n'; }],
  ];
  for (const [reason, damage] of cases) {
    const files = cgroupFiles(); damage(files);
    const result = await readNodeMemoryResources(fakeResources(files));
    assert.equal(result.usableSwapBytes, 0, reason);
    assert.equal(result.swapReason, reason);
    assert.equal(result.availableRamBytes, 4 * GIB, 'RAM already comes from process.availableMemory');
  }
});

test('each spawn resamples available RAM, preserves other flags, and never mutates the parent environment', async () => {
  let available = 2 * GIB;
  const reader = () => readNodeMemoryResources(fakeResources({'/proc/meminfo':noSwap}, {availableMemory:() => available}));
  const env = {NODE_OPTIONS:'--trace-warnings --max-old-space-size=12288 --require "path with space\\\\and\\\"quote"', TOKEN:'kept-private'};
  const first = await createResourceNodeInvocation({args:['job.mjs'], env, role:'test-memory', readResources:reader});
  available = GIB;
  const second = await createResourceNodeInvocation({args:['job.mjs'], env, readResources:reader});
  assert.equal(first.plan.heapMiB, 2048); assert.equal(second.plan.heapMiB, 1024);
  assert.deepEqual(parseNodeOptions(first.env.NODE_OPTIONS), ['--trace-warnings', '--require', 'path with space\\and"quote']);
  assert.match(env.NODE_OPTIONS, /12288/); assert.equal(first.env.TOKEN, env.TOKEN);
  assert.equal(first.plan.usableSwapBytes, 0); assert.equal(first.plan.swapReason, 'no_free_swap');
  await assert.rejects(readNodeMemoryResources(fakeResources({}, {availableMemory:() => 0})), /ram_unavailable/);
});

test('libuv unlimited uint64 constraint does not reject or inflate valid available RAM', async () => {
  // Node's uint64_t -> double conversion of libuv UINT64_MAX; no allocations.
  const unlimited = Number((1n << 64n) - 1n);
  assert.equal(Number.isSafeInteger(unlimited), false);
  for (const constraint of [0, GIB, 8 * GIB, Number.MAX_SAFE_INTEGER + 1, unlimited]) {
    const resources = await readNodeMemoryResources(fakeResources({'/proc/meminfo':noSwap}, {
      availableMemory:() => 2 * GIB, constrainedMemory:() => constraint,
    }));
    const expected = constraint === GIB ? GIB : 2 * GIB;
    assert.equal(resources.availableRamBytes, expected);
    assert.equal(resources.constrainedRamBytes, constraint);
    const invocation = await createResourceNodeInvocation({args:['job.mjs'], env:{}, readResources:async () => resources});
    assert.equal(invocation.plan.capacityBytes, expected);
    assert.equal(invocation.plan.heapMiB, expected / MIB);
  }
  for (const constraint of [-1, 1.5, NaN, Infinity, -Infinity, 2 ** 65, 'max', undefined]) {
    await assert.rejects(readNodeMemoryResources(fakeResources({'/proc/meminfo':noSwap}, {
      constrainedMemory:() => constraint,
    })), /ram_unavailable/);
  }
  for (const field of ['availableMemory', 'totalMemory']) {
    for (const bytes of [0, -1, NaN, Infinity, 1.5, unlimited]) {
      await assert.rejects(readNodeMemoryResources(fakeResources({'/proc/meminfo':noSwap}, {
        [field]:() => bytes, constrainedMemory:() => unlimited,
      })), /ram_unavailable/);
    }
  }
});

test('the launched Node process confirms its real heap instead of silently reverting to default or inherited old-space flags', async () => {
  const code = 'console.log(JSON.stringify({heap:require("node:v8").getHeapStatistics().heap_size_limit,title:process.title,options:process.env.NODE_OPTIONS}))';
  const invocation = await createResourceNodeInvocation({args:['--max-heap-size=8192', '--title=resource-memory-test', '-e', code],
    env:{...process.env, NODE_OPTIONS:'--trace-warnings --max_old_space_size=32 --max-semi-space-size=4 --max-old-space-size-percentage=50'},
    role:'test-memory', readResources:async () => ({...await smallResourceFixture(), constrainedRamBytes:Number((1n << 64n) - 1n)})});
  const result = await run(process.execPath, invocation.args, {env:invocation.env, timeout:10000});
  const actual = JSON.parse(result.stdout), telemetry = JSON.parse(result.stderr.trim());
  assert.equal(actual.heap, 256 * MIB); assert.equal(actual.title, 'resource-memory-test');
  assert.deepEqual(parseNodeOptions(actual.options), ['--trace-warnings']);
  assert.equal(telemetry.requestedHeapBytes, actual.heap); assert.equal(telemetry.actualHeapBytes, actual.heap);
  assert.equal(telemetry.availableRamBytes, 256 * MIB + 1200);
  assert.equal(telemetry.constrainedRamBytes, Number((1n << 64n) - 1n));
  const conflicting = [...invocation.args.slice(0, 3), '--max-old-space-size=32', ...invocation.args.slice(3)];
  await assert.rejects(run(process.execPath, conflicting, {env:invocation.env, timeout:10000}), (error:any) => {
    assert.match(error.stderr, /node_resource_heap_not_applied/); assert.equal(error.stdout, ''); return true;
  });
});

test('telemetry forwarding selects only resource records and safe fields, including failed-child startup output', () => {
  const output:string[] = [];
  const count = forwardResourceNodeTelemetry('arbitrary private diagnostic\n' + JSON.stringify({stage:'node_resource_memory',
    role:'serving-read-model', requestedHeapBytes:256 * MIB, actualHeapBytes:256 * MIB, TOKEN:'private',
    nodeVersion:process.version, swapReason:'no_free_swap', availableRamBytes:300 * MIB,
    constrainedRamBytes:Number((1n << 64n) - 1n)}) + '\n', (line:string) => output.push(line));
  assert.equal(count, 1); assert.equal(output.length, 1); assert.doesNotMatch(output[0], /private|TOKEN/);
  assert.equal(JSON.parse(output[0]).availableRamBytes, 300 * MIB);
  assert.equal(JSON.parse(output[0]).constrainedRamBytes, Number((1n << 64n) - 1n));
});

test('the three-file copied launcher preserves script arguments, output and failure status outside its repository', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'node-resource-launcher-test-'));
  try {
    await fs.mkdir(path.join(directory, 'scripts/lib'), {recursive:true});
    for (const name of ['scripts/run-node-with-resources.mjs', 'scripts/lib/node-resource-memory.mjs', 'scripts/lib/node-resource-memory-startup.mjs']) {
      await fs.copyFile(path.join(root, name), path.join(directory, name));
    }
    await fs.writeFile(path.join(directory, 'target.mjs'), 'console.log(JSON.stringify(process.argv.slice(2))); process.exitCode = 7;');
    await assert.rejects(run(process.execPath, [path.join(directory, 'scripts/run-node-with-resources.mjs'),
      path.join(directory, 'target.mjs'), '--max-old-space-size=123', 'argument with spaces'],
    {cwd:directory, env:{...process.env, NODE_OPTIONS:'--trace-warnings --max-old-space-size=32'}, timeout:10000}), (error:any) => {
      assert.equal(error.code, 7);
      assert.deepEqual(JSON.parse(error.stdout), ['--max-old-space-size=123', 'argument with spaces']);
      const telemetry = JSON.parse(error.stderr.trim());
      assert.equal(telemetry.stage, 'node_resource_memory');
      assert.equal(telemetry.requestedHeapBytes, telemetry.actualHeapBytes);
      assert.ok(telemetry.requestedHeapBytes > 0);
      return true;
    });
  } finally { await fs.rm(directory, {recursive:true, force:true}); }
});
