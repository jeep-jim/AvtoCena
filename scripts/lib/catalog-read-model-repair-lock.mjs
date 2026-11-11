import { randomUUID } from 'node:crypto';

// The repair workflow has a 90-minute hard timeout. Keep the storage lease
// longer than that entire job, including verification, so the Japan publisher
// (which uses this same lock) cannot start while aliases are being restored.
export async function withCatalogReadModelRepairLock(mutate, repair, now = Date.now) {
  const path = 'catalog/import-lock.json';
  const operationId = `read-model-repair-${randomUUID()}`;
  const lease = await mutate(path, { lockedUntil: '' }, current => {
    if (current.lockedUntil && !Number.isFinite(Date.parse(String(current.lockedUntil)))) {
      throw new Error('catalog_read_model_repair_publication_lock_invalid');
    }
    if (Date.parse(String(current.lockedUntil || '')) > now()) {
      throw new Error('catalog_read_model_repair_publication_locked');
    }
    return { operationId, operationType: 'catalog_read_model_repair',
      startedAt: new Date(now()).toISOString(),
      lockedUntil: new Date(now() + 100 * 60_000).toISOString() };
  });
  try {
    return await repair(Object.freeze({ ...lease }));
  } finally {
    await mutate(path, { lockedUntil: '' }, current => current.operationId === operationId
      ? { ...current, lockedUntil: '', finishedAt: new Date(now()).toISOString() }
      : current);
  }
}
