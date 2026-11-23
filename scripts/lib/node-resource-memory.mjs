import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {getHeapStatistics} from 'node:v8';

const MIB = 1024 ** 2;
const PLAN_ENV = 'AVTOCENA_NODE_RESOURCE_MEMORY_PLAN';
const MEMORY_FLAGS = new Set(['max-old-space-size', 'max-old-space-size-percentage', 'max-semi-space-size',
  'max-heap-size', 'initial-heap-size', 'initial-old-space-size', 'min-semi-space-size']);
const VALUE_FLAGS = new Set(['--import', '--require', '-r', '--loader', '--experimental-loader', '--input-type',
  '--eval', '-e', '--print', '-p', '--conditions', '-C', '--env-file', '--env-file-if-exists', '--title',
  '--icu-data-dir', '--openssl-config', '--diagnostic-dir', '--report-directory', '--report-dir',
  '--report-filename', '--report-signal', '--trace-event-categories', '--trace-event-file-pattern',
  '--test-name-pattern', '--test-skip-pattern', '--test-reporter', '--test-reporter-destination',
  '--test-concurrency', '--test-timeout', '--test-shard', '--experimental-test-isolation',
  '--experimental-default-type', '--experimental-config-file', '--unhandled-rejections',
  '--dns-result-order', '--use-largepages', '--redirect-warnings', '--heapsnapshot-signal',
  '--heap-prof-dir', '--heap-prof-name', '--heap-prof-interval', '--cpu-prof-dir', '--cpu-prof-name',
  '--cpu-prof-interval', '--inspect-port', '--max-http-header-size', '--stack-trace-limit']);
const startupUrl = new URL('./node-resource-memory-startup.mjs', import.meta.url).href;

// NODE_OPTIONS uses Node's double-quote grammar, not a shell. In particular,
// single quotes and backslashes outside double quotes are literal characters.
export function parseNodeOptions(value = '') {
  if (typeof value !== 'string') throw Error('node_resource_options_invalid');
  const result = [];
  let token = '', quoted = false;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === '"') { quoted = !quoted; continue; }
    if (char === '\\' && quoted) {
      if (++index === value.length) throw Error('node_resource_options_unterminated_escape');
      token += value[index];
    } else if (char === ' ' && !quoted) {
      if (token) result.push(token);
      token = '';
    } else token += char;
  }
  if (quoted) throw Error('node_resource_options_unterminated_quote');
  if (token) result.push(token);
  return result;
}

const serializeNodeOptions = tokens => tokens.map(token => '"' + token.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(' ');

export function stripNodeMemoryArguments(args, {environment = false} = {}) {
  if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) throw Error('node_resource_arguments_invalid');
  const result = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    // Arguments of the application are not Node options and must be left alone.
    if (!environment && (arg === '--' || !arg.startsWith('-') || arg === '-')) {
      result.push(...args.slice(index));
      break;
    }
    const equal = arg.indexOf('='), rawName = equal < 0 ? arg : arg.slice(0, equal);
    const name = rawName.replace(/_/g, '-');
    if (name.startsWith('--') && MEMORY_FLAGS.has(name.slice(2))) {
      const value = equal < 0 ? args[++index] : arg.slice(equal + 1);
      if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) throw Error('node_resource_memory_option_invalid');
      continue;
    }
    result.push(arg);
    if (equal < 0 && VALUE_FLAGS.has(name) && index + 1 < args.length) result.push(args[++index]);
  }
  return result;
}

const isBytes = value => Number.isSafeInteger(value) && value >= 0;
// libuv returns UINT64_MAX for an unlimited cgroup, and Node converts that
// uint64_t to double. It rounds to 2**64, outside JS's safe integer range.
// A limit above physical RAM is still a valid bound: only compare/min it;
// never add it to usable capacity or treat it as available memory.
const isMemoryBound = value => Number.isInteger(value) && value >= 0 && value <= Number((1n << 64n) - 1n);
function readBytes(value) {
  if (!/^\d+$/.test(value.trim())) throw Error('invalid_accounting');
  const number = Number(value.trim());
  if (!isBytes(number)) throw Error('invalid_accounting');
  return number;
}
function headroom(limit, current) {
  const used = readBytes(current);
  return limit.trim() === 'max' ? Infinity : Math.max(0, readBytes(limit) - used);
}
function mountField(value) {
  return value.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
}

async function readCgroupHeadroom(readFile) {
  const membership = (await readFile('/proc/self/cgroup', 'utf8')).trim().split('\n');
  if (membership.some(line => line.split(':')[1]?.split(',').includes('memory'))) {
    return {verified:false, reason:'cgroup_v1_memory_unverified'};
  }
  const v2 = membership.filter(line => line.startsWith('0::'));
  if (v2.length !== 1) return {verified:false, reason:'cgroup_v2_membership_unverified'};
  const member = v2[0].slice(3);
  if (!member.startsWith('/') || member.split('/').includes('..')) return {verified:false, reason:'cgroup_v2_path_unverified'};
  const mounts = (await readFile('/proc/self/mountinfo', 'utf8')).trim().split('\n').flatMap(line => {
    const split = line.split(' - ');
    if (split.length !== 2 || split[1].split(' ')[0] !== 'cgroup2') return [];
    const fields = split[0].split(' ');
    return fields.length >= 6 ? [{root:mountField(fields[3]), mount:mountField(fields[4])}] : [];
  });
  // A subtree mount cannot prove the limits of hidden ancestors. Do not count
  // swap unless the entire visible hierarchy can be accounted for.
  if (mounts.length !== 1 || mounts[0].root !== '/' || !path.isAbsolute(mounts[0].mount)) {
    return {verified:false, reason:'cgroup_v2_mount_unverified'};
  }
  const mount = path.resolve(mounts[0].mount);
  let directory = path.resolve(mount, '.' + member), memory = Infinity, swap = Infinity, scopes = 0;
  if (directory !== mount && !directory.startsWith(mount + path.sep)) return {verified:false, reason:'cgroup_v2_path_unverified'};
  while (true) {
    const names = ['memory.max', 'memory.current', 'memory.swap.max', 'memory.swap.current'];
    const files = await Promise.allSettled(names.map(name => readFile(path.join(directory, name), 'utf8')));
    // At the genuine cgroup root these controller files do not exist. A
    // namespaced root can hide stricter ancestors, so root controller files
    // must not be mistaken for the complete hierarchy.
    const absentRoot = directory === mount && files.every(file => file.status === 'rejected' && file.reason?.code === 'ENOENT');
    if (directory === mount && (!absentRoot || scopes === 0)) {
      return {verified:false, reason:'cgroup_v2_root_scope_unverified'};
    }
    if (!absentRoot) {
      if (files.some(file => file.status === 'rejected')) return {verified:false, reason:'cgroup_v2_accounting_unverified'};
      memory = Math.min(memory, headroom(files[0].value, files[1].value));
      swap = Math.min(swap, headroom(files[2].value, files[3].value));
      scopes++;
    }
    if (directory === mount) break;
    directory = path.dirname(directory);
  }
  return {verified:true, memory, swap, scopes};
}

export async function readNodeMemoryResources({readFile = fs.readFile, platform = process.platform,
  availableMemory = () => process.availableMemory(), constrainedMemory = () => process.constrainedMemory(),
  totalMemory = () => os.totalmem()} = {}) {
  const physicalRamBytes = totalMemory(), constrainedRamBytes = constrainedMemory();
  let availableRamBytes = availableMemory();
  if (!isBytes(physicalRamBytes) || physicalRamBytes === 0 || !isMemoryBound(constrainedRamBytes)
      || !isBytes(availableRamBytes) || availableRamBytes === 0) throw Error('node_resource_ram_unavailable');
  availableRamBytes = Math.min(availableRamBytes, physicalRamBytes, constrainedRamBytes || Infinity);
  const result = {physicalRamBytes, constrainedRamBytes, availableRamBytes, observedSwapFreeBytes:0,
    usableSwapBytes:0, swapReason:'platform_swap_unverified', cgroupMemoryHeadroomBytes:null,
    cgroupSwapHeadroomBytes:null, cgroupScopes:0};
  if (platform !== 'linux') return result;
  try {
    const info = await readFile('/proc/meminfo', 'utf8');
    const swapField = name => {
      const match = new RegExp('^' + name + ':\\s+(\\d+)\\s+kB\\s*$', 'm').exec(info);
      if (!match) throw Error('swap_accounting_invalid');
      const bytes = readBytes(match[1]) * 1024;
      if (!isBytes(bytes)) throw Error('swap_accounting_invalid');
      return bytes;
    };
    const totalSwap = swapField('SwapTotal'), freeSwap = swapField('SwapFree');
    if (freeSwap > totalSwap) throw Error('swap_accounting_invalid');
    result.observedSwapFreeBytes = freeSwap;
    if (freeSwap === 0) return {...result, swapReason:'no_free_swap'};
    let cgroup;
    try { cgroup = await readCgroupHeadroom(readFile); }
    catch { return {...result, swapReason:'cgroup_v2_accounting_unverified'}; }
    if (!cgroup.verified) return {...result, swapReason:cgroup.reason};
    return {...result, availableRamBytes:Math.min(availableRamBytes, cgroup.memory),
      usableSwapBytes:Math.min(freeSwap, cgroup.swap), swapReason:cgroup.swap === 0 ? 'cgroup_swap_exhausted' : 'cgroup_v2_verified',
      cgroupMemoryHeadroomBytes:Number.isFinite(cgroup.memory) ? cgroup.memory : null,
      cgroupSwapHeadroomBytes:Number.isFinite(cgroup.swap) ? cgroup.swap : null, cgroupScopes:cgroup.scopes};
  } catch { return {...result, swapReason:'proc_swap_unverified'}; }
}

export async function createResourceNodeInvocation({args, env = process.env, role = 'heavy-node',
  readResources = readNodeMemoryResources}) {
  if (!/^[a-z0-9_.-]{1,64}$/.test(role)) throw Error('node_resource_role_invalid');
  const cleanArgs = stripNodeMemoryArguments(args), cleanEnv = {...env};
  const options = serializeNodeOptions(stripNodeMemoryArguments(parseNodeOptions(cleanEnv.NODE_OPTIONS || ''), {environment:true}));
  if (options) cleanEnv.NODE_OPTIONS = options;
  else delete cleanEnv.NODE_OPTIONS;
  const resources = await readResources();
  if (!isBytes(resources.availableRamBytes) || !isBytes(resources.usableSwapBytes)) throw Error('node_resource_capacity_invalid');
  const capacityBytes = resources.availableRamBytes + resources.usableSwapBytes;
  const heapMiB = Math.floor(capacityBytes / MIB);
  if (!Number.isSafeInteger(capacityBytes) || heapMiB < 1) throw Error('node_resource_capacity_unavailable');
  // This is an upper bound from presently available resources, not a reservation
  // or an OOM guarantee: native/external allocations also use RAM and swap.
  const plan = {version:1, role, sampledAt:new Date().toISOString(), ...resources, capacityBytes, heapMiB};
  cleanEnv[PLAN_ENV] = JSON.stringify(plan);
  return {args:['--max-heap-size=' + heapMiB, '--import', startupUrl, ...cleanArgs], env:cleanEnv, plan};
}

export function reportResourceNodeStartup() {
  let plan;
  try { plan = JSON.parse(process.env[PLAN_ENV] || ''); }
  catch { throw Error('node_resource_plan_missing'); }
  if (plan?.version !== 1 || !/^[a-z0-9_.-]{1,64}$/.test(plan.role || '')
      || !Number.isSafeInteger(plan.heapMiB) || plan.heapMiB < 1
      || !isBytes(plan.capacityBytes) || plan.heapMiB !== Math.floor(plan.capacityBytes / MIB)) {
    throw Error('node_resource_plan_invalid');
  }
  const actualHeapBytes = getHeapStatistics().heap_size_limit;
  const memory = process.memoryUsage();
  const telemetry = {stage:'node_resource_memory', role:plan.role, nodeVersion:process.version,
    sampledAt:plan.sampledAt, requestedHeapBytes:plan.heapMiB * MIB, actualHeapBytes,
    physicalRamBytes:plan.physicalRamBytes, constrainedRamBytes:plan.constrainedRamBytes,
    availableRamBytes:plan.availableRamBytes, observedSwapFreeBytes:plan.observedSwapFreeBytes,
    usableSwapBytes:plan.usableSwapBytes, swapReason:plan.swapReason,
    cgroupMemoryHeadroomBytes:plan.cgroupMemoryHeadroomBytes, cgroupSwapHeadroomBytes:plan.cgroupSwapHeadroomBytes,
    cgroupScopes:plan.cgroupScopes, startupAvailableRamBytes:process.availableMemory(),
    rssBytes:memory.rss, heapUsedBytes:memory.heapUsed, externalBytes:memory.external};
  process.stderr.write(JSON.stringify(telemetry) + '\n');
  if (actualHeapBytes !== telemetry.requestedHeapBytes) throw Error('node_resource_heap_not_applied');
  return telemetry;
}

export function forwardResourceNodeTelemetry(stderr, write = text => process.stderr.write(text)) {
  let count = 0;
  for (const line of String(stderr || '').split('\n')) {
    if (!line.startsWith('{')) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event?.stage !== 'node_resource_memory' || !/^[a-z0-9_.-]{1,64}$/.test(event.role || '')
        || !isBytes(event.requestedHeapBytes) || !isBytes(event.actualHeapBytes)) continue;
    const safe = {stage:event.stage, role:event.role};
    for (const [name, value] of Object.entries(event)) {
      if (/Bytes$/.test(name) && (value === null || isBytes(value)
          || name === 'constrainedRamBytes' && isMemoryBound(value))) safe[name] = value;
    }
    if (Number.isSafeInteger(event.cgroupScopes) && event.cgroupScopes >= 0) safe.cgroupScopes = event.cgroupScopes;
    if (/^v\d+\.\d+\.\d+$/.test(event.nodeVersion || '')) safe.nodeVersion = event.nodeVersion;
    if (/^[a-z0-9_]+$/.test(event.swapReason || '')) safe.swapReason = event.swapReason;
    if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(event.sampledAt || '')) safe.sampledAt = event.sampledAt;
    write(JSON.stringify(safe) + '\n');
    count++;
  }
  return count;
}
