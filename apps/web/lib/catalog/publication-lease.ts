export type CatalogRepairLease = {
  operationId: string;
  operationType: 'catalog_read_model_repair';
  startedAt: string;
  lockedUntil: string;
};

/** A nested derivative build may share only the exact, still-live repair lease. */
export function assertCatalogDerivativeLease(current: Partial<CatalogRepairLease> | null,
  owner: CatalogRepairLease | undefined, errorPrefix: string, now = Date.now()) {
  const expiry = Date.parse(current?.lockedUntil || '');
  if (current?.lockedUntil && !Number.isFinite(expiry)) throw Error(`${errorPrefix}_publication_lock_invalid`);
  if (owner) {
    if (!owner.operationId.startsWith('read-model-repair-') || owner.operationType !== 'catalog_read_model_repair'
      || !Number.isFinite(Date.parse(owner.startedAt)) || !(expiry > now)
      || current?.operationId !== owner.operationId || current?.operationType !== owner.operationType
      || current?.startedAt !== owner.startedAt || current?.lockedUntil !== owner.lockedUntil) {
      throw Error(`${errorPrefix}_publication_lease_lost`);
    }
  } else if (expiry > now) throw Error(`${errorPrefix}_publication_in_progress`);
}
