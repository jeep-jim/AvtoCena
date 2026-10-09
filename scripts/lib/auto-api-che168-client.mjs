const BASE = 'https://api1.auto-api.com/api/v2/che168/';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Fixed origin, no redirects, and no upstream bodies/URLs in errors or logs. */
export function autoApiChe168Client({apiKey, fetchImpl = fetch, sleep = delay, deadline = Infinity, requestDelayMs = 0}) {
  apiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!apiKey || /\s/.test(apiKey)) throw Error('auto_api_key_missing_or_invalid');
  if (!Number.isSafeInteger(requestDelayMs) || requestDelayMs < 0 || requestDelayMs > 60000) throw Error('auto_api_invalid_request_delay');
  const pause = async ms => {
    if (Date.now() + ms >= deadline) throw Error('auto_api_time_budget');
    if (ms > 0) await sleep(ms);
  };
  return async (endpoint, params = {}) => {
    if (!['offers', 'offer', 'changes', 'change_id'].includes(endpoint)) throw Error('auto_api_invalid_endpoint');
    const url = new URL(endpoint, BASE);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    url.searchParams.set('api_key', apiKey);
    for (let attempt = 0; attempt < 4; attempt++) {
      await pause(requestDelayMs);
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
        try { return await response.json(); } catch {
          // A truncated/invalid success body must retry the SAME request, not
          // abandon hours of pagination or advance past unreceived records.
          // Four attempts and the shared deadline still fail closed.
          if (attempt === 3) throw Error('auto_api_invalid_json');
          await sleep(1000 * 2 ** attempt); continue;
        }
      }
      // A refusal is final. Do not retry with alternate identities or routes.
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        const header = response.headers.get('retry-after');
        const seconds = header && /^\d+(?:\.\d+)?$/.test(header) ? Number(header) : NaN;
        const retryAfter = Number.isFinite(seconds) ? seconds * 1000 : header ? Date.parse(header) - Date.now() : 0;
        await response.body?.cancel();
        // Respect the provider's full Retry-After instead of retrying early at
        // 30 seconds. Without a hint, allow a rate limit time to cool down.
        await pause(Math.max((response.status === 429 ? 30000 : 1000) * 2 ** attempt, Number.isFinite(retryAfter) ? retryAfter : 0));
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

/** /offer is documented and observed in both wrapped and flat forms. Keep the
 * outer identity explicit so the normalizer can still validate the canonical
 * source URL and every required field. */
export function autoApiChe168Detail(payload, expectedInnerId) {
  let row=payload?.inner_id ? payload : payload?.result;
  if(String(row?.inner_id)!==String(expectedInnerId)) throw Error('auto_api_detail_identity_mismatch');
  if(!row?.data && typeof row?.url==='string') row={inner_id:row.inner_id,data:row};
  if(!row?.data) throw Error('auto_api_detail_identity_mismatch');
  return row;
}

/** Resume only a successfully published paid-feed cursor. Periodic snapshots
 * revalidate unchanged rows before the catalogue's 14-day observation expiry. */
export function autoApiChe168Resume(saved, {yearFrom, now=Date.now(), forceSnapshot=false}={}) {
  if (forceSnapshot || !saved) return null;
  const row=saved.sources?.find(row=>row.sourceId==='autohome_used_china_open');
  if (row?.provider!=='auto_api_che168') return null;
  if (saved.version!==1 || saved.market!=='china' || !saved.generationId
    || !Number.isSafeInteger(row.cursor) || row.cursor<0
    || !['source_finished','source_changes_finished'].includes(row.stopReason)) throw Error('auto_api_invalid_saved_cursor');
  const snapshotAge=now-Date.parse(row.snapshotStartedAt), age=now-Date.parse(saved.updatedAt);
  if (!Number.isFinite(snapshotAge) || !Number.isFinite(age) || age<0 || snapshotAge<0) throw Error('auto_api_invalid_saved_cursor');
  if (snapshotAge>=7*86400000 || row.yearFrom!==yearFrom) return null;
  return {cursor:row.cursor,snapshotStartedAt:row.snapshotStartedAt};
}

function verifiedChangePage(payload, cursor, includeData=false) {
  if (!Array.isArray(payload?.result) || !payload.meta || payload.meta.cur_change_id !== cursor) throw Error('auto_api_invalid_changes');
  if (!payload.result.length) return {items:[],next:null};
  const next=payload.meta.next_change_id;
  if (!Number.isSafeInteger(next) || next<=cursor) throw Error('auto_api_stalled_changes');
  const items=payload.result.map(change=>{
    if (!/^\d+$/.test(String(change?.inner_id || '')) || !['added','changed','removed'].includes(change?.change_type)
      || !Number.isSafeInteger(change.id) || change.id<cursor || change.id>next
      || !Number.isFinite(Date.parse(change.created_at))) throw Error('auto_api_invalid_change');
    // Full detail is fetched separately; keep bounded lookahead metadata only.
    return {id:change.id,inner_id:change.inner_id,change_type:change.change_type,created_at:change.created_at,...(includeData?{data:change.data}:{})};
  });
  return {items,next};
}

/** Full bootstrap or delta replay. Only the caller can commit after publication. */
export async function collectAutoApiChe168({request, yearFrom, resume=null, onOffer, onRemoval, useChangeData=false, onPriceChange=async()=>false, onProgress = async()=>{}, now = ()=>new Date().toISOString()}) {
  const startedAt = now();
  const mode=resume?'delta':'snapshot';
  const snapshotStartedAt=resume?.snapshotStartedAt || startedAt;
  const start = resume || await request('change_id', {date: startedAt.slice(0, 10)});
  let cursor = resume ? start.cursor : start?.change_id;
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw Error('auto_api_invalid_change_id');
  if (!Number.isFinite(Date.parse(snapshotStartedAt))) throw Error('auto_api_invalid_saved_cursor');
  const initialCursor=cursor;
  const futurePages=new Map();
  const readChanges=async at=>futurePages.get(at) || verifiedChangePage(await request('changes',{change_id:at}),at,useChangeData);
  const confirmedLaterRemoval=async(change,at)=>{
    for(let pages=0;pages<1000;pages++){
      const page=await readChanges(at);
      // No progress or cursor is committed for this speculative read. The
      // normal loop must still process every intervening event in order.
      if(futurePages.size>=1000&&!futurePages.has(at))throw Error('auto_api_detail_404_unresolved');
      futurePages.set(at,page);
      if((pages+1)%50===0)console.log(JSON.stringify({detail404RemovalLookup:true,pages:pages+1,workingCursor:cursor,lookupCursor:at}));
      const removal=page.items.find(e=>String(e.inner_id)===String(change.inner_id) && e.change_type==='removed'
        && e.id>change.id && Date.parse(e.created_at)>=Date.parse(change.created_at));
      if(removal)return removal;
      if(page.next===null)break;
      at=page.next;
    }
    throw Error('auto_api_detail_404_unresolved');
  };
  let pages = 0, rows = 0, changes = 0, page = resume ? null : 1;
  while (page !== null) {
    const parsed = autoApiPage(await request('offers', {page, year_from: yearFrom}), page);
    for (const row of parsed.items) { await onOffer(row, now()); rows++; }
    pages++; page = parsed.next;
    await onProgress({pages, rows, changes, cursor, phase:'snapshot'});
  }
  // Replay from the captured date cursor to include writes during pagination.
  // /offer gives the current full listing, never promote a price-only delta.
  while (true) {
    const page=await readChanges(cursor);
    futurePages.delete(cursor);
    if (!page.items.length) break;
    const next=page.next;
    const latest = new Map();
    for (const change of page.items) {
      const previous = latest.get(String(change.inner_id));
      if (!previous || previous.id < change.id) latest.set(String(change.inner_id), change);
    }
    for (const change of (useChangeData ? [...page.items].sort((a,b)=>a.id-b.id) : latest.values())) {
      if (change.change_type === 'removed') {
        // Original event time protects a more recently observed active listing.
        await onRemoval(change, startedAt);
      } else {
        if (useChangeData && change.data?.inner_id && change.data?.url) {
          const row=autoApiChe168Detail({inner_id:change.inner_id,data:change.data},change.inner_id);
          await onOffer(row,change.created_at,change); continue;
        }
        if (useChangeData && change.change_type==='changed' && change.data && Object.keys(change.data).length===1
          && Object.hasOwn(change.data,'new_price') && await onPriceChange(change)) continue;
        let response;
        try { response=await request('offer', {inner_id: change.inner_id}); }
        catch(error){
          if(error?.message!=='auto_api_http_404')throw error;
          const removal=await confirmedLaterRemoval(change,next);
          await onRemoval(removal,startedAt);
          console.log(JSON.stringify({detail404ResolvedByExplicitRemoval:true}));
          continue;
        }
        const row = autoApiChe168Detail(response,change.inner_id);
        await onOffer(row, now(), change);
      }
    }
    changes += page.items.length; cursor = next;
    await onProgress({pages, rows, changes, cursor, phase:'changes'});
  }
  return {startedAt, completedAt: now(), pages, rows, changes, cursor, initialCursor, mode, snapshotStartedAt, yearFrom};
}

export function isCompletedChe168Delta(report) {
  const row=report?.sources?.find(row=>row.sourceId==='autohome_used_china_open');
  return report?.provider==='auto_api_che168' && report.market==='china' && report.completed===true && !report.failure
    && Number.isFinite(Date.parse(report.completedAt)) && row?.provider==='auto_api_che168' && row.syncMode==='delta'
    && row.stopReason==='source_changes_finished' && row.rejectedIdentity===0 && row.pages===0
    && Number.isSafeInteger(row.initialCursor) && row.initialCursor>=0
    && Number.isSafeInteger(row.cursor) && row.cursor>=row.initialCursor;
}
