import fs from 'node:fs/promises';
import path from 'node:path';

// At most 500 observation revisions (normally 250 cars) per raw shard.
export function observationShardWriter(directory, sourceId) {
  if (!/^[a-z0-9_-]+$/i.test(sourceId)) throw Error('invalid_intake_source');
  let count = 0;
  let queue = Promise.resolve();
  return row => (queue = queue.then(async () => {
    const part = Math.floor(count / 500) + 1;
    const filename = path.join(directory, `${sourceId}-${String(part).padStart(6, '0')}.jsonl`);
    // A reused directory must never silently mix old and new collection runs.
    if (count % 500 === 0) await fs.writeFile(filename, '', { flag: 'wx' });
    await fs.appendFile(filename, JSON.stringify(row) + '\n');
    count++;
  }));
}

export function restoreIntakeCursor(state, saved, now = Date.now()) {
  if (saved?.version !== 1 || saved.market !== state.source.market) return;
  const age = now - Date.parse(saved.updatedAt || '');
  if (!Number.isFinite(age) || age < 0 || age > 14 * 86400000) return;
  const row = saved.sources?.find(row => row.sourceId === state.sourceId);
  if (row && (row.cursor === null || typeof row.cursor === 'string')) {
    state.cursor = row.cursor;
    state.initialCursor = row.cursor;
  }
}

export function publishedIntakeCheckpoint(intake, publication) {
  if (!publication?.published || !publication.generationId || publication.market !== intake?.market) {
    throw Error('intake_cursor_requires_successful_publication');
  }
  if (!intake.completedAt || !Array.isArray(intake.sources)) throw Error('intake_incomplete_report');
  return { version: 1, market: intake.market, updatedAt: intake.completedAt,
    generationId: publication.generationId,
    sources: intake.sources.map(row => ({ sourceId: row.sourceId,
      cursor: row.cursor ?? null, stopReason: row.stopReason })) };
}
