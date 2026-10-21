export async function auditStableCatalogSnapshot({ audit, readManifest, readLock, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), timeoutMs = 600_000, onRetry = () => {} }) {
  const deadline = now() + timeoutMs;
  for (let attempt = 1; ; attempt++) {
    const report = await audit();
    const manifest = await readManifest();
    const moved = String(manifest?.generationId || '') !== report.generationId;
    if (report.ok && !moved) return report;
    const lock = await readLock();
    const publishing = Date.parse(String(lock?.lockedUntil || '')) > now();
    // A stable mismatch without a writer is a real error, not a retry excuse.
    if (!moved && !publishing) return report;
    if (now() >= deadline) {
      const error = new Error('catalog_current_readmodel_stability_timeout');
      error.report = report;
      throw error;
    }
    onRetry({ attempt, reason: moved ? 'manifest_changed' : 'publication_in_progress' });
    await sleep(Math.min(15_000, Math.max(0, deadline - now())));
  }
}
