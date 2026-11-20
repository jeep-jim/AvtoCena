// One-shot signed GET of fixed REG staging summaries only. No supplier,
// coordinator, shared lock, list, mutation, raw archives, or name/history output.
import { createHash, createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const HOST = 's3.regru.cloud';
const PREFIX = '/avtocena-staging-8120751/migration-staging/full-20261011/';
const CTRL = 'catalog/operations/collection-controls-v1.json';
const PUBLIC = 'catalog/manifest.json';
const stored = ['korea', 'uae', 'georgia', 'green'];
const ops = (market) => `catalog/operations/markets/${market}.json`;
export const approvedKeys = Object.freeze([CTRL, PUBLIC, ...stored.map(ops)]);
const cap = (key) => key === PUBLIC ? 2 * 1024 ** 2 : 512 * 1024;
const sha = (value) => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
const need = (ok, code) => { if (!ok) throw Error(code); };

async function exactBody(response, key) {
  if (response.status === 404) { await response.body?.cancel(); return null; }
  const length = response.headers.get('content-length') ?? '';
  const max = cap(key);
  if (!(response.status === 200 && response.body && !response.headers.get('content-encoding')
    && /^\d{1,8}$/.test(length) && +length > 0 && +length <= max)) {
    await response.body?.cancel();
    throw Error('response_bound_or_status');
  }
  const reader = response.body.getReader();
  const parts = []; let bytes = 0, finished = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) { finished = true; break; }
      bytes += value.byteLength;
      need(bytes <= max && bytes <= +length, 'response_bound_or_status');
      parts.push(value);
    }
    need(bytes === +length, 'response_length');
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts, bytes)));
    need(value && typeof value === 'object' && !Array.isArray(value), 'response_shape');
    return value;
  } finally {
    if (!finished) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function createScopedRead({ fetcher = fetch, env = process.env, clock = Date.now } = {}) {
  const seen = new Set();
  const deadline = clock() + 15_000;
  return Object.freeze({
    count: () => seen.size,
    async get(key) {
      need(approvedKeys.includes(key) && !seen.has(key) && seen.size < 6 && clock() < deadline, 'read_scope');
      const access = env.YC_OBJECT_STORAGE_ACCESS_KEY_ID, secret = env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY;
      need(typeof access === 'string' && access.length > 0 && typeof secret === 'string' && secret.length > 0, 'signed_read_unavailable');
      const datetime = new Date(clock()).toISOString().replace(/[:-]|\.\d{3}/g,'');
      const day = datetime.slice(0,8), scope = day + '/us-east-1/s3/aws4_request';
      const pathname = PREFIX + key, empty = sha('');
      const headers = { host: HOST, 'x-amz-content-sha256': empty, 'x-amz-date': datetime };
      const names = Object.keys(headers).sort(), signed = names.join(';');
      const request = ['GET',pathname,'',names.map(name=>name+':'+headers[name]+'\n').join(''),signed,empty].join('\n');
      const signing = hmac(hmac(hmac(hmac('AWS4'+secret,day),'us-east-1'),'s3'),'aws4_request');
      headers.authorization = 'AWS4-HMAC-SHA256 Credential='+access+'/'+scope+', SignedHeaders='+signed+', Signature='+
        createHmac('sha256', signing).update(['AWS4-HMAC-SHA256',datetime,scope,sha(request)].join('\n')).digest('hex');
      seen.add(key); // one actual attempt per key, including a failed response
      const r = await fetcher('https://'+HOST+pathname, { method:'GET', headers, redirect:'error',
        signal:AbortSignal.timeout(Math.max(1, Math.min(12_000, deadline-clock()))) });
      return exactBody(r, key);
    },
  });
}

const bit = (row) => typeof row?.enabled === 'boolean' ? row.enabled : null;
const and = (a,b) => a === false || b === false ? false : a === true && b === true ? true : null;
const qty = (n) => Number.isSafeInteger(n) && n >= 0 ? n : null;
const timestamp = (x, now) => {
  if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(x)) return null;
  const t = Date.parse(x);
  return Number.isFinite(t) && t <= now ? new Date(t).toISOString() : null;
};
const f = (x) => x === true ? true : x === false ? false : null;

function observations(row) {
  if (row.collectionComplete !== true || !Array.isArray(row.sources) || row.sources.length > 16) return null;
  // Current complete attempts can still contain partial supplemental routes.
  // This is observations on required routes, not distinct market listings.
  const required = row.sources.filter(s => s?.required === true);
  if (!required.length || required.some(s => qty(s.observations) === null)) return null;
  return qty(required.reduce((n,s) => n+s.observations,0));
}

export async function inspectCollectionOperations({ reader, now = Date.now() }) {
  const result = await Promise.allSettled(approvedKeys.map(key => reader.get(key)));
  const value = new Map(approvedKeys.map((key,i)=>[key,result[i].status==='fulfilled'?result[i].value:null]));
  const rawControl = value.get(CTRL);
  // Missing controls are not an owner decision. Never apply documented defaults.
  const control = rawControl?.version === 1 && Number.isSafeInteger(rawControl.revision)
    && rawControl.revision >= 0 && rawControl.markets && rawControl.sources ? rawControl : null;
  const switches = (market, requested) => {
    const ownerMarketEnabled = bit(control?.markets?.[market]);
    return { ownerMarketEnabled, ...Object.fromEntries(Object.entries(requested)
      .map(([out,id])=>[out,and(ownerMarketEnabled,bit(control?.sources?.[id]))])) };
  };
  const publicValue = value.get(PUBLIC);
  const publicFor = market => publicValue?.version === 2 ? publicValue.markets?.[market] : null;
  const summaryFor = market => {
    const val = value.get(ops(market)), marketRow = publicFor(market);
    const row = val?.version === 2 && val.market === market ? val : null;
    return { lastCompleteCollectionAt: timestamp(row?.lastCollectionSuccess,now),
      latestAttemptComplete: f(row?.collectionComplete),
      latestCompleteAttemptRequiredObservations: row && timestamp(row.lastCollectionSuccess,now) ? observations(row) : null,
      lastJournalPublicationAt: timestamp(row?.lastPublicationSuccess,now),
      lastJournalPublicationRows: qty(row?.publishedCount),
      publicManifestMarketAt: timestamp(marketRow?.updatedAt,now),
      publicManifestRows: qty(marketRow?.count) };
  };
  const g = value.get(ops('green'));
  const green = g?.status === 'published' && timestamp(g.lastCollectionSuccess,now)
    && timestamp(g.lastPublicationSuccess,now) ? g : null;
  return { signedGets:reader.count(), supplierRequests:0, storageWrites:0,
    allSixObjectsRead:result.every(r=>r.status==='fulfilled'&&r.value!==null),
    ownerControlsObserved:control!==null,
    korea:{...switches('korea',{paidEncarEnabled:'encar_feed',legacyAjesEnabled:'ajes_korea_feed',
      encarParserEnabled:'encar_direct',kcarParserEnabled:'kcar_korea_open'}),...summaryFor('korea')},
    uae:{...switches('uae',{paidDubiCarsEnabled:'dubicars_feed',dubiCarsParserEnabled:'dubicars_uae_exact',
      dubizzleParserEnabled:'dubizzle_uae_open',carSwitchParserEnabled:'carswitch_uae_open'}),...summaryFor('uae')},
    georgia:{...switches('georgia',{myAutoEnabled:'myauto_georgia_list',autoPapaEnabled:'autopapa_georgia_open'}),...summaryFor('georgia')},
    japan:{...switches('japan',{ajesOnDemandEnabled:'ajes_japan_feed'}),localFullDownloadAllowed:false},
    green:{...switches('japan',{akebonoEnabled:'akebono_green'}),
      lastCompleteCollectionAt:timestamp(green?.lastCollectionSuccess,now),
      collectedSourceRows:qty(green?.sourceCount),lastJournalPublicationAt:timestamp(green?.lastPublicationSuccess,now),
      lastJournalPublicationRows:qty(green?.publishedCount)} };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2 || !process.env.YC_OBJECT_STORAGE_ACCESS_KEY_ID || !process.env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY) {
    console.error(JSON.stringify({ok:false,signedGets:0,supplierRequests:0,storageWrites:0}));
    process.exitCode = 2;
  } else {
    const result = await inspectCollectionOperations({reader:createScopedRead()});
    console.log(JSON.stringify(result));
    if (!result.ownerControlsObserved || !result.allSixObjectsRead) process.exitCode = 2;
  }
}
