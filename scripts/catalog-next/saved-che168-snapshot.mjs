import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';

const PART = 16 * 1024 * 1024;
const sha = value => createHash('sha256').update(value).digest('hex');
const need = (condition, code) => { if (!condition) throw Error('catalog_next_source_' + code); };
const parse = bytes => {
  try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
  catch { throw Error('catalog_next_source_invalid_json'); }
};
const integer = n => Number.isSafeInteger(n) && n >= 0;
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** Strict raw-object adapter. readObject may only GET already saved exact keys. */
export async function openSavedChe168Snapshot({readObject, manifestKey, manifestSha256, expectedTerminalCursor, schema}) {
  need(typeof readObject === 'function' && hex(manifestSha256) && schema === 'auto-api-che168-v2', 'snapshot_descriptor');
  const match = typeof manifestKey === 'string' && manifestKey.match(/^catalog\/provider-snapshots\/che168\/([a-f0-9]{64})\/manifest\.json$/);
  need(match, 'snapshot_key');
  const binding = match[1], prefix = manifestKey.slice(0, -'manifest.json'.length);
  async function read(key, maxBytes) {
    let value;
    try { value = await readObject(key, {maxBytes}); }
    catch { throw Error('catalog_next_source_snapshot_read_failed'); }
    need(Buffer.isBuffer(value) && value.length > 0 && value.length <= maxBytes, 'snapshot_object');
    return value;
  }
  const wire = await read(manifestKey, 4 * 1024 * 1024);
  need(sha(wire) === manifestSha256, 'snapshot_manifest_checksum');
  const manifest = parse(wire), config = manifest?.config;
  need(manifest?.version === 1 && manifest.complete === true && manifest.binding === binding
    && config?.version === 1 && config.host === 'https://autobase-barrett.auto-api.com'
    && /^\d{4}-\d{2}-\d{2}$/.test(config.date) && config.filename === 'active_offer.csv' && config.delimiter === '|'
    && integer(config.initialCursor) && integer(config.bytes) && config.bytes > 0
    && /^"[^"\r\n]+"$/.test(config.etag) && Number.isFinite(Date.parse(config.modifiedAt))
    && sha(JSON.stringify(config)) === binding && Array.isArray(manifest.parts)
    && manifest.parts.length === Math.ceil(config.bytes / PART), 'snapshot_manifest');
  need(integer(expectedTerminalCursor) && expectedTerminalCursor >= config.initialCursor, 'snapshot_target_cursor');
  for (const [index, part] of manifest.parts.entries()) need(part?.index === index && hex(part.sha256)
    && part.bytes === Math.min(PART, config.bytes - index * PART), 'snapshot_part_descriptor');
  const source = Object.freeze({provider: 'auto_api_che168', schema, snapshotBinding: binding,
    snapshotManifestSha256: manifestSha256, initialCursor: config.initialCursor,
    expectedTerminalCursor, observedAt: config.modifiedAt});
  let completed = null, started = false;
  async function* chunks() {
    for (const [index, part] of manifest.parts.entries()) {
      const compressed = await read(prefix + String(index).padStart(5, '0') + '.csv.gz', PART + 1024 * 1024);
      let decoded;
      try { decoded = gunzipSync(compressed, {maxOutputLength: PART}); }
      catch { throw Error('catalog_next_source_snapshot_part_compression'); }
      need(decoded.length === part.bytes && sha(decoded) === part.sha256, 'snapshot_part_checksum');
      yield decoded;
    }
  }
  async function* rows() {
    need(!started, 'snapshot_already_consumed'); started = true;
    const child = spawn('python3', [fileURLToPath(new URL('./che168-csv.py', import.meta.url))], {stdio: ['pipe', 'pipe', 'pipe']});
    child.stderr.resume();
    const exit = new Promise(resolve => { child.on('error', () => resolve(-1)); child.on('close', resolve); });
    let inputError, count = 0, terminal = null;
    const input = pipeline(chunks(), child.stdin).catch(error => { inputError = error; child.kill(); });
    try {
      for await (const line of createInterface({input: child.stdout, crlfDelay: Infinity})) {
        const value = parse(Buffer.from(line));
        if (value.kind === 'complete') { need(!terminal && integer(value.rows), 'csv_terminal'); terminal = value; }
        else {
          need(!terminal && value.kind === 'row' && integer(value.line), 'csv_shape'); count++;
          yield {row: value.row, origin: {key: manifestKey, sha256: manifestSha256, line: value.line}};
        }
      }
      await input;
      if (inputError) throw inputError;
      need(await exit === 0 && terminal?.rows === count, 'invalid_csv');
      completed = {rows: count, bytes: config.bytes, binding, manifestSha256};
    } finally {
      child.kill(); await input; await exit;
    }
  }
  return {source, rows: rows(), async assertComplete() { need(completed, 'snapshot_not_exhausted'); return {...completed}; }};
}
