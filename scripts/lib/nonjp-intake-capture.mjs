import assert from 'node:assert/strict';

export function assertDubicarsPriorIntake(files, report) {
  assert.ok(files.every(name => name === 'report.json'
    || /^(?:raw-)?(?:dubizzle_uae_open|carswitch_uae_open)-[0-9]+\.jsonl$/.test(name)), 'auto_api_intake_output_not_empty');
  assert.ok(report?.market === 'uae' && Array.isArray(report.sources)
    && report.sources.every(row => ['dubizzle_uae_open', 'carswitch_uae_open'].includes(row.sourceId)), 'auto_api_invalid_prior_intake');
}

/** One existing request, one awaited private record, then the same payload.
 * The wrapper never records request credentials/URLs/headers or repeats a call. */
export function captureDubicarsResponses(request, write, {now = () => new Date().toISOString()} = {}) {
  return async (endpoint, params) => {
    assert.ok(['change_id', 'offers', 'changes', 'offer'].includes(endpoint), 'intake_archive_provider_endpoint');
    const payload = await request(endpoint, params);
    const safeParams = Object.fromEntries(Object.entries(params || {}).filter(([key]) =>
      ['page', 'year_from', 'inner_id', 'change_id', 'date'].includes(key)));
    await write({version: 1, kind: 'provider_response', provider: 'auto_api_dubicars', endpoint,
      params: safeParams, observedAt: now(), payload});
    return payload;
  };
}
