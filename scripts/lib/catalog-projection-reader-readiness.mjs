// New scoped roots must never reach a server that only understands all.json.
export async function assertScopedProjectionReaderReady(fetchImpl = fetch) {
  const response = await fetchImpl('https://avtocena.com/api/health', {cache:'no-store',signal:AbortSignal.timeout(20_000)});
  if (!response.ok) throw Error('catalog_projection_reader_health_failed');
  const health = await response.json();
  if (!health.ok || !/^[a-f0-9]{40}$/.test(health.releaseSha || '') || health.catalogProjectionParts !== 'scoped-v1')
    throw Error('catalog_projection_scoped_reader_not_installed');
  return {releaseSha:health.releaseSha,format:health.catalogProjectionParts};
}
