import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import {constants, createReadStream} from 'node:fs';
import path from 'node:path';
import {gzip, gunzipSync} from 'node:zlib';
import {promisify} from 'node:util';
import {CHINA_GENERATION_FILES, chinaGenerationRoot} from './generation-storage.mjs';

const compress = promisify(gzip), PART = 8 * 1024 * 1024;
const SHA = /^[a-f0-9]{64}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const need = (value, code) => assert(value, 'china_generation_' + code);
const required = ['DISPOSITIONS.ndjson', 'FILTER_SEMANTICS.json', 'FX_RECEIPT.json', 'GENERATION.json',
  'RECONCILIATION.json', 'RUNTIME_CONTEXT.json', 'SOURCE.json', 'details.sqlite', 'query.sqlite', 'source.sqlite'];
const same = (a, b) => a.ino === b.ino && a.dev === b.dev && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;

async function sealFile(filename) {
  const before = await fs.lstat(filename);
  need(before.isFile() && !before.isSymbolicLink() && before.nlink === 1, 'file_type');
  const digest = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(filename)) { bytes += chunk.length; digest.update(chunk); }
  need(bytes === before.size && same(before, await fs.lstat(filename)), 'file_changed');
  return {bytes, sha256: digest.digest('hex'), identity: before};
}

async function parallel(count, task) {
  let next = 0, error;
  const worker = async () => {
    while (!error) { const i = next++; if (i >= count) return;
      try { await task(i); } catch (failure) { error ??= failure; }
    }
  };
  await Promise.all(Array.from({length: Math.min(4, count)}, worker));
  if (error) throw error;
}

/** Store the actual complete generation, including the next refresh's source.
 * Each immutable part is optionally compressed, but BOTH encoded and decoded
 * hashes are checked after a private readback. No pointer is published here. */
export async function savePrivateChinaGeneration({storage, owner, files, binding, onProgress = () => {}, assertAuthority = () => {}}) {
  const root = chinaGenerationRoot(owner), names = Object.keys(files ?? {}).sort();
  need(names.length > 0 && names.every(name => CHINA_GENERATION_FILES.includes(name)) && required.every(name => names.includes(name)), 'file_set');
  need(binding?.market === 'china' && /^gen_[a-zA-Z0-9_-]{1,180}$/.test(binding.generationId ?? '') &&
    /^[a-f0-9]{40}$/.test(binding.runtimeSha ?? '') && SHA.test(binding.sourceDescriptorSha256 ?? '') &&
    SHA.test(binding.generationManifestSha256 ?? ''), 'binding');
  need((await storage.assertPrivateBucket())?.verified === true, 'privacy'); await assertAuthority();
  const records = [];
  for (const name of names) {
    const filename = files[name];
    need(typeof filename === 'string' && path.isAbsolute(filename), 'path');
    const seal = await sealFile(filename); need(seal.bytes > 0, 'empty_file');
    const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    const parts = new Array(Math.ceil(seal.bytes / PART)); let completed = 0;
    try {
      need(same(seal.identity, await handle.stat()), 'file_changed');
      await parallel(parts.length, async index => {
        await assertAuthority();
        const length = Math.min(PART, seal.bytes - index * PART), raw = Buffer.allocUnsafe(length);
        let read = 0;
        while (read < length) {
          const result = await handle.read(raw, read, length - read, index * PART + read);
          need(result.bytesRead > 0, 'short_read'); read += result.bytesRead;
        }
        const packed = await compress(raw, {level: 6});
        const encoding = packed.length < raw.length ? 'gzip' : 'identity', bytes = encoding === 'gzip' ? packed : raw;
        const sha256 = hash(bytes), rawSha256 = hash(raw), key = `${root}/files/${name}/${index}-${sha256}`;
        await storage.putBinary(key, bytes, 'application/octet-stream', {ifNoneMatch: '*'});
        const readback = await storage.getBinary(key);
        need(Buffer.isBuffer(readback?.data) && readback.data.length === bytes.length && hash(readback.data) === sha256, 'part_readback');
        const decoded = encoding === 'gzip' ? gunzipSync(readback.data, {maxOutputLength: PART}) : readback.data;
        need(decoded.length === raw.length && hash(decoded) === rawSha256, 'part_decoded_readback');
        parts[index] = {key, bytes: bytes.length, sha256, encoding, rawBytes: raw.length, rawSha256};
        completed++;
        if (completed % 25 === 0) await onProgress({phase: 'generation_parts_saved', file: name, parts: completed, totalParts: parts.length});
      });
      need(same(seal.identity, await handle.stat()) && same(seal.identity, await fs.lstat(filename)), 'file_changed');
    } finally { await handle.close(); }
    const again = await sealFile(filename); need(again.sha256 === seal.sha256 && again.bytes === seal.bytes, 'file_changed');
    records.push({name, bytes: seal.bytes, sha256: seal.sha256, parts});
    await onProgress({phase: 'generation_file_saved', file: name, bytes: seal.bytes,
      storedBytes: parts.reduce((n, p) => n + p.bytes, 0), parts: parts.length});
  }
  need(records.find(file => file.name === 'SOURCE.json').sha256 === binding.sourceDescriptorSha256 &&
    records.find(file => file.name === 'GENERATION.json').sha256 === binding.generationManifestSha256, 'manifest_binding');
  await assertAuthority(); need((await storage.assertPrivateBucket())?.verified === true, 'privacy');
  const receipt = {version: 1, kind: 'china-private-generation-v1', market: 'china', owner: {...owner}, root,
    binding, files: records, totalBytes: records.reduce((sum, file) => sum + file.bytes, 0),
    storedBytes: records.reduce((sum, file) => sum + file.parts.reduce((n, p) => n + p.bytes, 0), 0),
    published: false, liveCatalogWrites: 0, deletions: 0};
  const body = Buffer.from(JSON.stringify(receipt)), receiptSha256 = hash(body);
  need(body.length <= PART, 'receipt_size');
  await storage.putBinary(root + '/complete.json', body, 'application/json', {ifNoneMatch: '*'});
  const checked = await storage.getBinary(root + '/complete.json');
  need(Buffer.isBuffer(checked?.data) && hash(checked.data) === receiptSha256, 'receipt_readback');
  await assertAuthority(); need((await storage.assertPrivateBucket())?.verified === true, 'privacy');
  return {receipt, receiptSha256};
}

/** Restore selected exact bytes for release or a later refresh. The caller
 * chooses a required subset; every chosen file is verified before exposure. */
export async function restorePrivateChinaGeneration({storage, owner, expectedReceiptSha256, outputDirectory, names, onProgress = () => {}}) {
  const root = chinaGenerationRoot(owner);
  need(SHA.test(expectedReceiptSha256 ?? '') && path.isAbsolute(outputDirectory) &&
    path.normalize(outputDirectory) === outputDirectory && await fs.realpath(path.dirname(outputDirectory)) === path.dirname(outputDirectory), 'restore_arguments');
  need(Array.isArray(names) && names.length > 0 && new Set(names).size === names.length && names.every(name => CHINA_GENERATION_FILES.includes(name)), 'restore_names');
  need((await storage.assertPrivateBucket())?.verified === true, 'privacy');
  const complete = await storage.getBinary(root + '/complete.json');
  need(Buffer.isBuffer(complete?.data) && hash(complete.data) === expectedReceiptSha256, 'receipt_checksum');
  const receipt = JSON.parse(complete.data);
  need(receipt?.version === 1 && receipt.kind === 'china-private-generation-v1' && receipt.market === 'china' && receipt.root === root &&
    JSON.stringify(receipt.owner) === JSON.stringify(owner) && receipt.published === false && receipt.liveCatalogWrites === 0 && receipt.deletions === 0 &&
    Array.isArray(receipt.files) && new Set(receipt.files.map(f => f.name)).size === receipt.files.length &&
    receipt.files.every(f => CHINA_GENERATION_FILES.includes(f.name)) && required.every(name => receipt.files.some(f => f.name === name)), 'receipt_identity');
  let totalBytes = 0, storedBytes = 0;
  for (const file of receipt.files) {
    need(Number.isSafeInteger(file.bytes) && file.bytes > 0 && SHA.test(file.sha256 ?? '') &&
      Array.isArray(file.parts) && file.parts.length === Math.ceil(file.bytes / PART), 'file_descriptor');
    file.parts.forEach((part, index) => {
      need(['gzip', 'identity'].includes(part.encoding) && Number.isSafeInteger(part.bytes) && part.bytes > 0 && part.bytes <= PART &&
        part.rawBytes === Math.min(PART, file.bytes - index * PART) && SHA.test(part.sha256 ?? '') && SHA.test(part.rawSha256 ?? '') &&
        part.key === `${root}/files/${file.name}/${index}-${part.sha256}`, 'part_descriptor');
      storedBytes += part.bytes;
    }); totalBytes += file.bytes;
  }
  need(totalBytes === receipt.totalBytes && storedBytes === receipt.storedBytes &&
    receipt.files.find(f => f.name === 'SOURCE.json').sha256 === receipt.binding?.sourceDescriptorSha256 &&
    receipt.files.find(f => f.name === 'GENERATION.json').sha256 === receipt.binding?.generationManifestSha256, 'receipt_totals');
  await fs.mkdir(outputDirectory, {mode: 0o700});
  const paths = {}, created = [];
  try {
    for (const name of names) {
      const file = receipt.files.find(f => f.name === name); need(file, 'missing_file');
      const filename = path.join(outputDirectory, name + '.partial');
      const handle = await fs.open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      created.push(filename); let completed = 0;
      try { await parallel(file.parts.length, async index => {
        const part = file.parts[index], result = await storage.getBinary(part.key);
        need(Buffer.isBuffer(result?.data) && result.data.length === part.bytes && hash(result.data) === part.sha256, 'part_checksum');
        const raw = part.encoding === 'gzip' ? gunzipSync(result.data, {maxOutputLength: PART}) : result.data;
        need(raw.length === part.rawBytes && hash(raw) === part.rawSha256, 'part_decoded_checksum');
        let written = 0;
        while (written < raw.length) {
          const value = await handle.write(raw, written, raw.length - written, index * PART + written);
          need(value.bytesWritten > 0, 'short_write'); written += value.bytesWritten;
        }
        completed++;
        if (completed % 25 === 0) await onProgress({phase: 'generation_parts_restored', file: name, parts: completed, totalParts: file.parts.length});
      }); await handle.sync(); } finally { await handle.close(); }
      const seal = await sealFile(filename); need(seal.bytes === file.bytes && seal.sha256 === file.sha256, 'file_checksum');
      await fs.chmod(filename, 0o400); paths[name] = path.join(outputDirectory, name);
    }
    need((await storage.assertPrivateBucket())?.verified === true, 'privacy');
    need(hash((await storage.getBinary(root + '/complete.json')).data) === expectedReceiptSha256, 'receipt_changed');
    // Expose the caller's manifests last. Exclusive links never replace a file.
    const ordered = [...names.filter(n => !['SOURCE.json', 'GENERATION.json'].includes(n)), ...names.filter(n => ['SOURCE.json', 'GENERATION.json'].includes(n))];
    for (const name of ordered) { await fs.link(paths[name] + '.partial', paths[name]); created.push(paths[name]);
      await fs.unlink(paths[name] + '.partial'); }
    return {receipt, receiptSha256: expectedReceiptSha256, paths};
  } catch (error) {
    for (const file of created) await fs.unlink(file).catch(() => {});
    await fs.rmdir(outputDirectory).catch(() => {}); throw error;
  }
}
