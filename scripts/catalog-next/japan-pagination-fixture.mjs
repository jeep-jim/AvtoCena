import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';

export const JAPAN_PAGINATION_FIXTURE_MAX_BYTES = 16 * 1024;
const need = (value, code) => { if (!value) throw Error('japan_pagination_fixture_' + code); };
const FIXTURE_KEYS = ['version', 'kind', 'passed', 'widths', 'caseCount', 'checks'];
const CHECKS = ['refill24', 'numberedContinuation', 'appendNoDuplicatesOrGaps', 'finiteExhaustion',
  'unknownPowerPreserved', 'failureHonesty', 'cursorBinding', 'warningRemoved', 'sourcePageSize24',
  'neighborPaginationPreserved', 'noExternalRequests'];
const POWER_CHECKS = [...CHECKS, 'knownBeforeUnknown', 'boundedKnownContinuation', 'evidenceEpochReset'];

// Snapshot only own data properties. Accessors, symbols and extra fields must
// never be invoked or echoed into a public or host-bound report.
function ownData(value, keys, code, array = false) {
  try {
    need(value !== null && typeof value === 'object' && Array.isArray(value) === array, code);
    const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
    need(names.length === keys.length && names.every(name => typeof name === 'string' && keys.includes(name)), code);
    const copy = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      need(descriptor && Object.hasOwn(descriptor, 'value'), code);
      copy[key] = descriptor.value;
    }
    return copy;
  } catch { throw Error('japan_pagination_fixture_' + code); }
}

export function checkedJapanPaginationBrowserFixture(report, {requirePowerOrder = false} = {}) {
  const value = ownData(report, FIXTURE_KEYS, 'fixture');
  const power = value.version === 2;
  need(typeof requirePowerOrder === 'boolean' && (!requirePowerOrder || power), 'power_order_required');
  need(value.version === (power ? 2 : 1) && value.kind === (power ? 'japan-pagination24-browser-v2' : 'japan-pagination24-browser-v1')
    && value.passed === true && value.caseCount === (power ? 12 : 8), 'fixture');
  const widths = ownData(value.widths, ['0', '1', 'length'], 'fixture_widths', true);
  need(widths.length === 2 && widths[0] === 390 && widths[1] === 1440, 'fixture_widths');
  const requiredChecks = power ? POWER_CHECKS : CHECKS;
  const checks = ownData(value.checks, requiredChecks, 'fixture_checks');
  need(requiredChecks.every(key => checks[key] === true), 'fixture_checks');
  return Object.freeze({version: value.version, kind: value.kind, passed: true, widths: Object.freeze([390, 1440]),
    caseCount: value.caseCount, checks: Object.freeze(checks)});
}

function checkedFixtureBytes(raw, options) {
  need(Buffer.isBuffer(raw) && raw.length > 0 && raw.length <= JAPAN_PAGINATION_FIXTURE_MAX_BYTES, 'fixture_size');
  let parsed;
  try { parsed = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(raw)); }
  catch { throw Error('japan_pagination_fixture_fixture_json'); }
  return checkedJapanPaginationBrowserFixture(parsed, options);
}

const regular = value => value.isFile() && !value.isSymbolicLink() && value.nlink === 1n
  && value.size > 0n && value.size <= BigInt(JAPAN_PAGINATION_FIXTURE_MAX_BYTES);
const identity = value => [value.dev, value.ino, value.nlink, value.size, value.mtimeNs, value.ctimeNs];
const unchanged = (left, right) => identity(left).every((value, index) => value === identity(right)[index]);

/** One local artifact, bounded by its original size and a fixed read buffer.
 * It is not accepted through a symlink, hard link, replaced path or changed fd. */
export async function readJapanPaginationFixture(filename, options) {
  let handle;
  try {
    need(typeof filename === 'string' && path.isAbsolute(filename) && path.resolve(filename) === filename, 'fixture_path');
    need(await fs.realpath(filename) === filename, 'fixture_path');
    const before = await fs.lstat(filename, {bigint: true});
    need(regular(before), 'fixture_file');
    handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat({bigint: true});
    need(regular(opened) && unchanged(before, opened), 'fixture_changed');
    const buffer = Buffer.alloc(JAPAN_PAGINATION_FIXTURE_MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const {bytesRead} = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    need(length === Number(before.size) && length <= JAPAN_PAGINATION_FIXTURE_MAX_BYTES, 'fixture_changed');
    const after = await handle.stat({bigint: true}), current = await fs.lstat(filename, {bigint: true});
    need(regular(after) && regular(current) && unchanged(before, after) && unchanged(before, current)
      && await fs.realpath(filename) === filename, 'fixture_changed');
    const raw = Buffer.from(buffer.subarray(0, length));
    checkedFixtureBytes(raw, options);
    return raw;
  } catch (error) {
    if (/^japan_pagination_fixture_[a-z_]+$/.test(error?.message ?? '')) throw error;
    throw Error('japan_pagination_fixture_fixture_read');
  } finally { if (handle) await handle.close(); }
}

