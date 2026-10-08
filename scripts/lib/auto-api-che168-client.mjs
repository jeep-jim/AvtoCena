const BASE = 'https://api1.auto-api.com/api/v2/che168/';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Fixed origin, no redirects, and no upstream bodies/URLs in errors or logs. */
export function autoApiChe168Client({apiKey, fetchImpl = fetch, sleep = delay, deadline = Infinity}) {
  apiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!apiKey || /\s/.test(apiKey)) throw Error('auto_api_key_missing_or_invalid');
  return async (endpoint, params = {}) => {
    if (!['offers', 'offer', 'changes', 'change_id'].includes(endpoint)) throw Error('auto_api_invalid_endpoint');
    const url = new URL(endpoint, BASE);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    url.searchParams.set('api_key', apiKey);
    for (let attempt = 0; attempt < 4; attempt++) {
      if (Date.now() >= deadline) throw Error('auto_api_time_budget');
      let response;
      try {
        response = await fetchImpl(url, {redirect:'error', headers:{accept:'application/json'},
          signal: AbortSignal.timeout(Math.min(30000, Math.max(1, deadline-Date.now())))});
      } catch {
        if (attempt === 3) throw Error('auto_api_transport_failed');
        await sleep(1000 * 2 ** attempt); continue;
      }
      if (response.ok) {
        try { return await response.json(); } catch { throw Error('auto_api_invalid_json'); }
      }
      // A refusal is final. Do not retry with alternate identities or routes.
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        const seconds = Number(response.headers.get('retry-after'));
        await response.body?.cancel();
        await sleep(Math.min(30000, Math.max(1000 * 2 ** attempt, Number.isFinite(seconds) ? seconds * 1000 : 0)));
        continue;
      }
      await response.body?.cancel();
      throw Error(`auto_api_http_${response.status}`);
    }
  };
}

export function autoApiPage(payload, currentPage) {
  if (!Array.isArray(payload?.result) || !payload.meta || payload.meta.page !== currentPage
    || !Object.hasOwn(payload.meta, 'next_page')) throw Error('auto_api_invalid_page');
  const next = payload.meta.next_page;
  if (next !== null && (!Number.isSafeInteger(next) || next <= currentPage || !payload.result.length)) throw Error('auto_api_invalid_next_page');
  return {items: payload.result, next};
}

/** Full snapshot then change replay. Only the caller can commit after publication. */
export async function collectAutoApiChe168({request, yearFrom, onOffer, onRemoval, onProgress = async()=>{}, now = ()=>new Date().toISOString()}) {
  const startedAt = now();
  const start = await request('change_id', {date: startedAt.slice(0, 10)});
  let cursor = start?.change_id;
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw Error('auto_api_invalid_change_id');
  let pages = 0, rows = 0, changes = 0, page = 1;
  while (page !== null) {
    const parsed = autoApiPage(await request('offers', {page, year_from: yearFrom}), page);
    for (const row of parsed.items) { await onOffer(row, now()); rows++; }
    pages++; page = parsed.next;
    await onProgress({pages, rows, changes, cursor, phase:'snapshot'});
  }
  // Replay from the captured date cursor to include writes during pagination.
  // /offer gives the current full listing, never promote a price-only delta.
  while (true) {
    const payload = await request('changes', {change_id: cursor});
    if (!Array.isArray(payload?.result) || !payload.meta || payload.meta.cur_change_id !== cursor) throw Error('auto_api_invalid_changes');
    if (!payload.result.length) break;
    const next = payload.meta.next_change_id;
    if (!Number.isSafeInteger(next) || next <= cursor) throw Error('auto_api_stalled_changes');
    const latest = new Map();
    for (const change of payload.result) {
      if (!/^\d+$/.test(String(change?.inner_id || '')) || !['added','changed','removed'].includes(change?.change_type)
        || !Number.isSafeInteger(change.id) || change.id < cursor || change.id > next
        || !Number.isFinite(Date.parse(change.created_at))) throw Error('auto_api_invalid_change');
      const previous = latest.get(String(change.inner_id));
      if (!previous || previous.id < change.id) latest.set(String(change.inner_id), change);
    }
    for (const change of latest.values()) {
      if (change.change_type === 'removed') {
        // Original event time protects a more recently observed active listing.
        await onRemoval(change, startedAt);
      } else {
        const response = await request('offer', {inner_id: change.inner_id});
        const row = response?.inner_id ? response : response?.result;
        if (String(row?.inner_id) !== String(change.inner_id) || !row?.data) throw Error('auto_api_detail_identity_mismatch');
        await onOffer(row, now());
      }
    }
    changes += payload.result.length; cursor = next;
    await onProgress({pages, rows, changes, cursor, phase:'changes'});
  }
  return {startedAt, completedAt: now(), pages, rows, changes, cursor};
}
