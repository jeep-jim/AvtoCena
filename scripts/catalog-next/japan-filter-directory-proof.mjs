import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 16 * 1024;
const SCOPE = 'Actual Japan brand/model controls with bounded local source fixtures; no production or supplier calls';
const CASES = ['source-options-only', 'make-change-clears-old-models', 'model-directory-failure-and-retry', 'brand-directory-failure-and-retry'];
const SOURCE_NAME_CASES = [...CASES, 'raw-source-selection', 'typed-source-make-aliases'];
const VISIBLE_FALLBACK_CASES = [...SOURCE_NAME_CASES,
  'brand-directory-fresh-empty-visible-and-retry',
  'brand-directory-stale-visible-and-retry',
  'brand-directory-error-visible-and-retry'];
const need = (value, code) => { if (!value) throw Error('japan_filter_directory_' + code); };
const exact = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const fields = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(fields).length === keys.length && keys.every(key => Object.hasOwn(fields[key] ?? {}, 'value'))
    && Reflect.ownKeys(fields).every(key => typeof key === 'string' && keys.includes(key));
};

export function checkedJapanFilterDirectoryFixture(value, {requireSourceNames = false, requireVisibleFallback = false} = {}) {
  need(exact(value, ['passed', 'scope', 'cases']) && value.passed === true && value.scope === SCOPE
    && Array.isArray(value.cases) && [8, 12, 18].includes(value.cases.length), 'fixture');
  const names = value.cases.length >= 12, fallback = value.cases.length === 18;
  need(typeof requireSourceNames === 'boolean' && (!requireSourceNames || names), 'source_names_required');
  need(typeof requireVisibleFallback === 'boolean' && (!requireVisibleFallback || fallback), 'visible_fallback_required');
  const expected = new Set([390, 1440].flatMap(width =>
    (fallback ? VISIBLE_FALLBACK_CASES : names ? SOURCE_NAME_CASES : CASES).map(name => width + ':' + name)));
  for (const row of value.cases) {
    need(exact(row, ['width', 'name', 'passed']) && row.passed === true
      && typeof row.width === 'number' && typeof row.name === 'string'
      && expected.delete(row.width + ':' + row.name), 'cases');
  }
  need(expected.size === 0, 'cases');
  return {passed: true, scope: SCOPE, cases: value.cases.map(row => ({width: row.width, name: row.name, passed: true}))};
}

const regular = info => info.isFile() && !info.isSymbolicLink() && info.nlink === 1n && info.size > 0n && info.size <= BigInt(MAX_BYTES);
const identity = value => [value.dev, value.ino, value.nlink, value.size, value.mtimeNs, value.ctimeNs];
const same = (left, right) => identity(left).every((value, index) => value === identity(right)[index]);

export async function readJapanFilterDirectoryFixture(filename, options) {
  let handle;
  try {
    need(typeof filename === 'string' && path.isAbsolute(filename) && path.resolve(filename) === filename
      && await fs.realpath(filename) === filename, 'path');
    const before = await fs.lstat(filename, {bigint: true}); need(regular(before), 'file');
    handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat({bigint: true}); need(regular(opened) && same(before, opened), 'changed');
    const buffer = Buffer.alloc(MAX_BYTES + 1); let size = 0;
    while (size < buffer.length) {
      const {bytesRead} = await handle.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break; size += bytesRead;
    }
    const after = await handle.stat({bigint: true}), current = await fs.lstat(filename, {bigint: true});
    need(size === Number(before.size) && size <= MAX_BYTES && regular(after) && regular(current)
      && same(before, after) && same(before, current) && await fs.realpath(filename) === filename, 'changed');
    const raw = Buffer.from(buffer.subarray(0, size));
    checkedJapanFilterDirectoryFixture(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(raw)), options);
    return raw;
  } catch (error) {
    if (/^japan_filter_directory_[a-z_]+$/.test(error?.message ?? '')) throw error;
    throw Error('japan_filter_directory_read');
  } finally { await handle?.close(); }
}
