import { randomUUID } from 'node:crypto';

// The repair workflow has a 30-minute hard timeout. Keep the storage lease
// longer than that entire job, including verification, so the Japan publisher
// (which uses this same lock) cannot start while aliases are being restored.
export async function withCatalogReadModelRepairLock(mutate, repair, now = Date.now) {
  const path = 'catalog/import-lock.json';
  const operationId = `read-model-repair-${randomUUID()}`;
  await mutate(path, { lockedUntil: '' }, current => {
    if (Date.parse(String(current.lockedUntil || '')) > now()) {
      throw new Error('catalog_read_model_repair_publication_locked');
    }
    return { operationId, operationType: 'catalog_read_model_repair',
      startedAt: new Date(now()).toISOString(),
      lockedUntil: new Date(now() + 40 * 60_000).toISOString() };
  });
  try {
    return await repair();
  } finally {
    await mutate(path, { lockedUntil: '' }, current => current.operationId === operationId
      ? { ...current, lockedUntil: '', finishedAt: new Date(now()).toISOString() }
      : current);
  }
}
