import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { classifySpecificationEvidence, SPECIFICATION_AUDIT_FIELDS } from '../apps/web/lib/catalog/specification-evidence-audit.ts';

const input = process.env.PARSER_AUDIT_INPUT || 'parser-audit-input';
const output = process.env.PARSER_AUDIT_OUTPUT || 'parser-audit-output';
const live = process.argv.includes('--live');
const selected = process.env.PARSER_AUDIT_SOURCE;
const sources = ['autohome_used_china_open', 'autohome_new_china_open', 'mobile_de_open', 'autoscout_europe_open',
  'encar_direct', 'kcar_korea_open', 'dubizzle_uae_open', 'dubicars_uae_exact', 'carswitch_uae_open',
  'autopapa_georgia_open', 'myauto_georgia_list', 'jptrade', 'sferacar', 'proauctions'];
if (selected && !sources.includes(selected)) throw Error('unknown_audit_source');
const fields = ['sourceOfferId', 'make', 'model', 'trim', 'year', 'productionDate', 'mileageKm', 'engineCc',
  'powerHp', 'powerKw', 'power30MinKw', 'fuel', 'powertrainKind', 'transmission', 'drive', 'bodyType', 'sourcePrice', 'sourceCurrency'];
const pick = (offer) => Object.fromEntries(fields.map(field => [field, offer[field] ?? null]));
const hash = text => createHash('sha256').update(text).digest('hex');
await fs.mkdir(output, { recursive: true });
const manifest = JSON.parse(await fs.readFile(path.join(input, 'manifest.json'), 'utf8'));
const report = { version: 1, checkedAt: new Date().toISOString(), productionWrites: false, cursorWrites: false,
  liveRequests: live, sourceAcceptance: false, mode: live ? 'bounded_source_recheck' : 'saved_extraction_audit', sources: [] };

// Explicit modules keep the audit out of importer/publisher initialization and
// use the adapter under review, not a deployed bridge running an older commit.
async function adapter(sourceId) {
  const modules = {
    autohome_used_china_open: ['che168-global-exact-source', 'che168GlobalExactSource'],
    autohome_new_china_open: ['autohome-new-exact-source', 'autohomeNewExactSource'],
    mobile_de_open: ['mobile-de-exact-source', 'mobileDeExactSource'],
    autoscout_europe_open: ['autoscout-exact-source', 'autoscoutEuropeExactSource'],
    encar_direct: ['encar-complete-source', 'encarCompleteSource'],
    kcar_korea_open: ['kcar-exact-source', 'kcarKoreaExactSource'],
    dubizzle_uae_open: ['dubizzle-exact-source', 'dubizzleUaeExactSource'],
    dubicars_uae_exact: ['dubicars-current-source', 'dubicarsUaeCurrentSource'],
    carswitch_uae_open: ['carswitch-exact-source', 'carswitchUaeExactSource'],
    autopapa_georgia_open: ['autopapa-georgia-source', 'autoPapaGeorgiaSource'],
    myauto_georgia_list: ['myauto-list-source', 'myAutoListSource'],
  };
  const entry = modules[sourceId];
  return entry ? (await import(`../apps/web/lib/catalog/${entry[0]}.ts`))[entry[1]] : null;
}

for (const sourceId of sources.filter(id => !selected || id === selected)) {
  const dir = path.join(output, sourceId);
  await fs.mkdir(dir, { recursive: true });
  let samples = [];
  try { samples = JSON.parse(await fs.readFile(path.join(input, `${sourceId}.json`), 'utf8')).slice(0, 10); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const result = { sourceId, archive: manifest[sourceId] || null, sampleCount: samples.length,
    requestedSampleCount: 10, liveCompleted: 0, accepted: false, samples: [], errors: [] };
  report.sources.push(result);
  let requests = 0;
  let denied = false;
  const deadline = Date.now() + 240_000;
  const originalFetch = globalThis.fetch;
  // Capture response bodies as reproducible parser evidence. Never record
  // authorization headers, cookies, or response Set-Cookie headers.
  globalThis.fetch = async (url, init = {}) => {
    if (!live) throw Error('offline_audit_network_forbidden');
    if (denied || requests >= 100 || Date.now() > deadline) throw Error('audit_source_request_budget');
    const target = new URL(typeof url === 'string' || url instanceof URL ? url : url.url);
    if (!['https:', 'http:'].includes(target.protocol)) throw Error('audit_protocol');
    if (init.method && !['GET', 'POST', 'HEAD'].includes(init.method.toUpperCase())) throw Error('audit_method');
    const index = ++requests;
    const response = await originalFetch(url, { ...init,
      signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000) });
    if ([401, 403, 429].includes(response.status)) denied = true;
    const type = response.headers.get('content-type') || '';
    let bodyFile = null, sha256 = null, truncated = false;
    if (/json|text|javascript|html/i.test(type)) {
      const reader = response.clone().body?.getReader();
      const chunks = []; let size = 0;
      while (reader) {
        const { done, value } = await reader.read(); if (done) break;
        if (size + value.length > 4_000_000) { truncated = true; void reader.cancel(); break; }
        chunks.push(Buffer.from(value)); size += value.length;
      }
      const body = Buffer.concat(chunks);
      bodyFile = `response-${index}.txt`; sha256 = hash(body);
      await fs.writeFile(path.join(dir, bodyFile), body);
    }
    await fs.appendFile(path.join(dir, 'requests.jsonl'), JSON.stringify({ url: target.toString(),
      status: response.status, contentType: type, bodyFile, sha256, truncated }) + '\n');
    return response;
  };
  try {
    const source = live ? await adapter(sourceId) : null;
    // Only the two sources with no saved rows get one bounded discovery page.
    // This cannot accidentally restart the inventory pagination loop.
    if (live && !samples.length && source) {
      try {
        const page = await source.fetchPage(null);
        for (const raw of (page.items || []).slice(0, 10)) {
          const offer = source.normalizeOffer(raw);
          if (offer) samples.push({ offer, stage: 'audit_discovery' });
        }
      } catch (error) { result.errors.push({ stage: 'discovery', message: String(error.message || error) }); }
    }
    for (const sample of samples) {
      const offer = sample.offer;
      const row = offer ? { id: offer.sourceOfferId, url: offer.operational?.sourceUrl, saved: pick(offer),
        evidence: Object.fromEntries(SPECIFICATION_AUDIT_FIELDS.map(field => [field, classifySpecificationEvidence(offer, field)])),
        sourceFields: offer.operational?.sourceSpecifications || null, semanticEvidence: offer.operational?.semanticEvidence || null,
        imageCount: offer.images?.length || 0, photoIdentityVerified: offer.operational?.photoIdentityVerified === true,
      } : { id: sample.sourceId, url: sample.sourceUrl, saved: sample,
        blockers: ['sold_price_semantics_require_review', 'photos_require_verification', 'production_adapter_not_accepted'] };
      result.samples.push(row);
      if (!live || denied || Date.now() > deadline) continue;
      const start = requests;
      try {
        if (source && offer) {
          let refreshed = structuredClone(offer);
          if (source.refreshOffer) refreshed = await source.refreshOffer(refreshed);
          else refreshed.images = await source.fetchImages(refreshed);
          row.reparsed = pick(refreshed);
          row.changes = fields.filter(f => JSON.stringify(offer[f] ?? null) !== JSON.stringify(refreshed[f] ?? null));
          row.networkRequests = requests - start;
          row.liveStatus = requests > start ? 'adapter_requested_source_review_required' : 'saved_gallery_only_not_a_live_check';
        } else if (row.url) {
          const response = await fetch(row.url, { headers: { 'user-agent': 'AvtoCena source parser audit/1.0' } });
          row.httpStatus = response.status;
          row.liveStatus = response.ok ? 'source_page_saved_parser_review_required' : 'source_unavailable';
        }
        if (requests > start) result.liveCompleted++;
      } catch (error) { row.liveStatus = 'failed'; row.error = String(error.message || error); }
    }
    result.sampleCount = samples.length;
    result.requestCount = requests;
    result.accessBlocked = denied;
  } finally { globalThis.fetch = originalFetch; }
  await fs.writeFile(path.join(dir, 'report.json'), JSON.stringify(result, null, 2));
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({sourceId, sampleCount:result.sampleCount, liveCompleted:result.liveCompleted, requests, accepted:false}));
}
