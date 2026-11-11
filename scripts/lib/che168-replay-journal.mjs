import {createHash, randomUUID} from 'node:crypto';
import {gzipSync, gunzipSync} from 'node:zlib';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validCursor = n => Number.isSafeInteger(n) && n >= 0;
const fail = () => { throw Error('auto_api_invalid_replay_checkpoint'); };
const MAX_BYTES = 512 * 1024 * 1024;
const MAX_CHUNK_BYTES = 64 * 1024 * 1024;
const MAX_RAW_BYTES = 8 * 1024 * 1024 * 1024;
const size = value => Buffer.byteLength(JSON.stringify(value));
const encode = chunk => ({encoding:'gzip-base64',data:gzipSync(Buffer.from(JSON.stringify(chunk)),{level:1}).toString('base64')});
function decode(value) {
  try { return JSON.parse(gunzipSync(Buffer.from(value.data,'base64'),{maxOutputLength:MAX_CHUNK_BYTES}).toString('utf8')); }
  catch { fail(); }
}

/** Private working progress, never a published catalog cursor. Immutable compressed
 * chunks and a conditional head commit data/cursor together. Legacy raw chunks are
 * migrated without deleting them; a failed migration leaves the old head usable. */
export async function openChe168ReplayJournal({storage, artifactRunId, binding, initialCursor, apply, readOnly = false}) {
  if (!/^\d+$/.test(String(artifactRunId)) || !/^[a-f0-9]{64}$/.test(binding) || !validCursor(initialCursor)) fail();
  const prefix = `catalog/intake-working/che168-v1/${artifactRunId}`;
  const key = `${prefix}/head.json`;
  let meta = await storage.readJsonWithMeta(key, null);
  let head = meta.found ? meta.value : {version:2, binding, initialCursor, cursor:initialCursor, changes:0, bytes:0, rawBytes:0, chunks:[]};
  if (![1,2].includes(head?.version) || head.binding !== binding || head.initialCursor !== initialCursor
    || !validCursor(head.cursor) || !validCursor(head.changes) || !validCursor(head.bytes)
    || head.bytes > MAX_BYTES || !Array.isArray(head.chunks) || head.chunks.length > 10000
    || (head.version === 2 && (!validCursor(head.rawBytes) || head.rawBytes > MAX_RAW_BYTES))
    || (meta.found && !meta.etag)) fail();
  let cursor = initialCursor, changes = 0, bytes = 0, rawBytes = 0;
  const migrated = []; let migratedBytes = 0;
  for (const descriptor of head.chunks) {
    if (!/^[a-f0-9-]{36}$/.test(descriptor?.id) || !/^[a-f0-9]{64}$/.test(descriptor?.sha)) fail();
    const stored = await storage.readJson(`${prefix}/${descriptor.id}.json`, null);
    if (!stored || digest(stored) !== descriptor.sha) fail();
    if (head.version === 2 && (stored.encoding !== 'gzip-base64' || typeof stored.data !== 'string' || size(stored) > MAX_CHUNK_BYTES)) fail();
    const chunk = head.version === 1 ? stored : decode(stored);
    if (chunk.binding !== binding || chunk.from !== cursor
      || !validCursor(chunk.to) || chunk.to <= cursor || !validCursor(chunk.changes) || chunk.changes <= 0
      || !Array.isArray(chunk.events) || chunk.events.length > chunk.changes) fail();
    const rawSize = size(chunk);
    bytes += size(stored); rawBytes += rawSize;
    if (bytes > MAX_BYTES || rawSize > MAX_CHUNK_BYTES || rawBytes > MAX_RAW_BYTES) fail();
    for (const event of chunk.events) await apply(event);
    cursor = chunk.to; changes += chunk.changes;
    if (head.version === 1 && !readOnly) {
      const compressed = encode(chunk), id = randomUUID();
      await storage.writeJson(`${prefix}/${id}.json`, compressed, {ifNoneMatch:'*'});
      migrated.push({id,sha:digest(compressed)}); migratedBytes += size(compressed);
    }
  }
  if (cursor !== head.cursor || changes !== head.changes || bytes !== head.bytes || (head.version === 2 && rawBytes !== head.rawBytes)) fail();
  async function saveHead(next) {
    await storage.writeJson(key, next, meta.found ? {ifMatch:meta.etag} : {ifNoneMatch:'*'});
    const nextMeta = await storage.readJsonWithMeta(key, null);
    if (!nextMeta.found || !nextMeta.etag || digest(nextMeta.value) !== digest(next)) fail();
    head = next; meta = nextMeta;
  }
  if (head.version === 1 && !readOnly) {
    if (migratedBytes > MAX_BYTES) throw Error('auto_api_replay_storage_budget');
    await saveHead({...head,version:2,bytes:migratedBytes,rawBytes,chunks:migrated});
    console.log(JSON.stringify({replayCheckpointCompressed:true,changes,cursor,rawBytes,bytes:migratedBytes}));
  }
  return {
    get cursor() { return head.cursor; },
    get changes() { return head.changes; },
    async commit({cursor, changes, events}) {
      if (readOnly) throw Error('auto_api_replay_read_only');
      if (!validCursor(cursor) || cursor <= head.cursor || !validCursor(changes) || changes <= head.changes
        || !Array.isArray(events) || events.length > changes - head.changes) fail();
      const chunk = {binding, from:head.cursor, to:cursor, changes:changes-head.changes, events};
      const rawSize = size(chunk), rawBytes = head.rawBytes + rawSize;
      if (rawSize > MAX_CHUNK_BYTES || rawBytes > MAX_RAW_BYTES || head.chunks.length >= 10000) throw Error('auto_api_replay_storage_budget');
      const stored = encode(chunk), bytes = head.bytes + size(stored);
      if (bytes > MAX_BYTES || size(stored) > MAX_CHUNK_BYTES) throw Error('auto_api_replay_storage_budget');
      const id = randomUUID(), sha = digest(stored);
      await storage.writeJson(`${prefix}/${id}.json`, stored, {ifNoneMatch:'*'});
      await saveHead({...head, cursor, changes, bytes, rawBytes, chunks:[...head.chunks, {id, sha}]});
      console.log(JSON.stringify({replayCheckpointSaved:true,changes,cursor,chunks:head.chunks.length,bytes,rawBytes}));
    }
  };
}
