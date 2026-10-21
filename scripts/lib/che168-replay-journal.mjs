import {createHash, randomUUID} from 'node:crypto';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validCursor = n => Number.isSafeInteger(n) && n >= 0;
const fail = () => { throw Error('auto_api_invalid_replay_checkpoint'); };
const MAX_BYTES = 512 * 1024 * 1024;

/** Private working progress, never a published catalog cursor. Chunks are
 * immutable; the conditional head write commits data and cursor together.
 * A failed write leaves the previous head usable, not a skipped page. */
export async function openChe168ReplayJournal({storage, artifactRunId, binding, initialCursor, apply}) {
  if (!/^\d+$/.test(String(artifactRunId)) || !/^[a-f0-9]{64}$/.test(binding) || !validCursor(initialCursor)) fail();
  const prefix = `catalog/intake-working/che168-v1/${artifactRunId}`;
  const key = `${prefix}/head.json`;
  let meta = await storage.readJsonWithMeta(key, null);
  let head = meta.found ? meta.value : {version:1, binding, initialCursor, cursor:initialCursor, changes:0, bytes:0, chunks:[]};
  if (head?.version !== 1 || head.binding !== binding || head.initialCursor !== initialCursor
    || !validCursor(head.cursor) || !validCursor(head.changes) || !validCursor(head.bytes)
    || head.bytes > MAX_BYTES || !Array.isArray(head.chunks) || head.chunks.length > 10000
    || (meta.found && !meta.etag)) fail();
  let cursor = initialCursor, changes = 0, bytes = 0;
  for (const descriptor of head.chunks) {
    if (!/^[a-f0-9-]{36}$/.test(descriptor?.id) || !/^[a-f0-9]{64}$/.test(descriptor?.sha)) fail();
    const chunk = await storage.readJson(`${prefix}/${descriptor.id}.json`, null);
    if (!chunk || digest(chunk) !== descriptor.sha || chunk.binding !== binding || chunk.from !== cursor
      || !validCursor(chunk.to) || chunk.to <= cursor || !validCursor(chunk.changes) || chunk.changes <= 0
      || !Array.isArray(chunk.events) || chunk.events.length > chunk.changes) fail();
    bytes += Buffer.byteLength(JSON.stringify(chunk));
    if (bytes > MAX_BYTES) fail();
    for (const event of chunk.events) await apply(event);
    cursor = chunk.to; changes += chunk.changes;
  }
  if (cursor !== head.cursor || changes !== head.changes || bytes !== head.bytes) fail();
  return {
    get cursor() { return head.cursor; },
    get changes() { return head.changes; },
    async commit({cursor, changes, events}) {
      if (!validCursor(cursor) || cursor <= head.cursor || !validCursor(changes) || changes <= head.changes
        || !Array.isArray(events) || events.length > changes - head.changes) fail();
      const chunk = {binding, from:head.cursor, to:cursor, changes:changes-head.changes, events};
      const bytes = head.bytes + Buffer.byteLength(JSON.stringify(chunk));
      if (bytes > MAX_BYTES) throw Error('auto_api_replay_storage_budget');
      const id = randomUUID(), sha = digest(chunk);
      await storage.writeJson(`${prefix}/${id}.json`, chunk, {ifNoneMatch:'*'});
      const next = {...head, cursor, changes, bytes, chunks:[...head.chunks, {id, sha}]};
      await storage.writeJson(key, next, meta.found ? {ifMatch:meta.etag} : {ifNoneMatch:'*'});
      const nextMeta = await storage.readJsonWithMeta(key, null);
      if (!nextMeta.found || !nextMeta.etag || digest(nextMeta.value) !== digest(next)) fail();
      head = next; meta = nextMeta;
      console.log(JSON.stringify({replayCheckpointSaved:true,changes,cursor,chunks:head.chunks.length}));
    }
  };
}
