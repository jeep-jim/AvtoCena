import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {InventoryError, need, hash, safeKey, safePrefix, createInventoryStorage} from './inventory-storage.mjs';
import {InventoryLedger} from './inventory-ledger.mjs';

export const SERVING_SCHEMA_SHA = '22867cbcfaee27b2e8917b6bf880e44827f67b60';
export const SOURCE_SCHEMA_SHA = '762ea753e29cc7d12880c5c88a8b0d52ca5d9ff9';
const SHA = /^[a-f0-9]{64}$/, RUN = /^[1-9]\d{0,19}$/, GEN = /^gen_\d{13}_[a-z0-9-]{1,64}$/;
const UUID = '[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
const semanticHash = value => hash(JSON.stringify(value));
const integer = value => Number.isSafeInteger(value) && value >= 0;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const CONTROL = 'catalog/independent-market-public-v1/china/control.json';
const OWNED = 'catalog/owned-feed/v1/china';
const CONFIG = 'catalog/raw-feed-config/v1/che168-snapshot.json';
const RAW_STATE = 'catalog/raw-feed-coordination/v1/state.json';
export const FIXED_ROOTS = Object.freeze([
  ['catalog/manifest.json', true], ['catalog/previous-manifest.json', false],
  [CONTROL, false], [OWNED + '/source.json', false], [OWNED + '/prepared.json', false],
  ['catalog/intake-cursors/v1/china.json', false], [CONFIG, false],
  ['catalog/raw-feed-coordination/v1/policy.json', false], [RAW_STATE, false], ['catalog/internal/manifest.json', false],
].map(([key, required]) => Object.freeze({key, required})));
export const PROTECTED_HEADS = Object.freeze([
  'catalog/operations/collection-controls-v1.json', 'markets/markets.json', 'settings/site-business.json',
  'fees/exchange-rates.json', 'catalog-editorial/current.json', 'knowledge/management-vehicle-parameters/v1/current.json',
  'knowledge/encyclopedia/v1/manifest.json', 'catalog/china-cny-prices/current.json',
  'catalog/operations/budget-preparation-v1.json',
]);
const patterns = Object.freeze({
  intake: /^catalog\/nonjp-intake\/v1\/china\/[1-9]\d{0,19}\/[1-9]\d{0,5}$/,
  snapshot: /^catalog\/provider-snapshots\/che168\/[a-f0-9]{64}$/,
  replica: new RegExp('^catalog/provider-replicas/che168/' + UUID + '$'),
  journal: /^catalog\/intake-working\/che168-v1\/[1-9]\d{0,19}$/,
  run: /^catalog\/owned-feed\/v1\/china\/runs\/[1-9]\d{0,19}$/,
  downloads: /^catalog\/owned-feed\/v1\/china\/downloads\/[1-9]\d{0,19}$/,
  stage: /^catalog\/private-market-stage-v1\/china\/[a-z0-9][a-z0-9-]{4,63}$/,
  generation: /^catalog\/generations\/gen_\d{13}_[a-z0-9-]{1,64}$/,
  rates: /^catalog\/feed-rates\/v1\/china\/[1-9]\d{0,19}\.json$/,
  pin: /^catalog\/raw-feed-pins\/v1\/[A-Za-z0-9_-]{1,180}\.json$/,
  handoff: /^catalog\/raw-feed-handoffs\/v1\/(?:che168-snapshot|che168-replica|che168-journal|nonjp-intake)\/[a-f0-9]{64}\.json$/,
});
const fileKinds = new Set(['rates', 'pin', 'handoff']);

/** The only dynamic expansion accepts exact known China reference families.
 * Protected settings are HEAD-only; broad catalog/, shared public aliases, foreign
 * markets and credential stores cannot be granted by a root payload. */
export function createInventoryScope() {
  const keys = new Set(FIXED_ROOTS.map(root => root.key)), prefixes = new Set(), heads = new Set(PROTECTED_HEADS);
  return Object.freeze({
    canRead(key, method = 'GET') { return safeKey(key) && (keys.has(key) || [...prefixes].some(prefix => key.startsWith(prefix)) || method === 'HEAD' && heads.has(key)); },
    canList(prefix) { return safePrefix(prefix) && prefixes.has(prefix); },
    reference(kind, root) {
      need(Object.hasOwn(patterns, kind) && typeof root === 'string' && patterns[kind].test(root) && safeKey(root), 'inventory_reference_scope');
      if (fileKinds.has(kind)) keys.add(root); else prefixes.add(root + '/');
      return fileKinds.has(kind) ? root : root + '/';
    },
  });
}
function decodeJson(record, maxBytes) {
  let bytes = record.data;
  if (record.contentEncoding === 'gzip') {
    try { bytes = gunzipSync(bytes, {maxOutputLength: maxBytes}); } catch { throw new InventoryError('inventory_json_encoding'); }
  } else need(record.contentEncoding === null || record.contentEncoding === '' || record.contentEncoding === 'identity' || record.contentEncoding === undefined,
    'inventory_json_encoding');
  need(bytes.length <= maxBytes, 'inventory_json_byte_limit');
  try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
  catch { throw new InventoryError('inventory_json_invalid'); }
}
function sameIdentity(a, b) {
  return a?.found === b?.found && (!a?.found || a.etag === b.etag && a.size === b.size
    && (a.versionId ?? null) === (b.versionId ?? null)
    && (a.contentEncoding ?? null) === (b.contentEncoding ?? null)
    && (a.contentType ?? null) === (b.contentType ?? null));
}
const safeError = error => error instanceof InventoryError && /^inventory_[a-z0-9_]+$/.test(error.code)
  ? error.code : 'inventory_unexpected_failure';

export async function inventoryChina({storage, scope, ledger, serving, maxJsonBytes = 32 * 1024 * 1024,
  clock = Date.now, deadline = Date.now() + 20 * 60000, onProgress = () => {}}) {
  need(storage && scope && ledger && serving?.releaseSha === SERVING_SCHEMA_SHA && SHA.test(serving.calculationVersion ?? ''), 'inventory_serving_identity');
  need(Number.isSafeInteger(maxJsonBytes) && maxJsonBytes >= 1024, 'inventory_resource_limit');
  const startedAt = new Date(clock()).toISOString(), heads = new Map(), roots = [], queue = [], queued = new Set(), references = [], unresolved = [];
  const archiveDigests = new Set(), stageArchiveDigests = new Set(), sourceRuns = new Map();
  const progress = phase => onProgress({phase, roots: structuredClone(roots), references: structuredClone(references), unresolved: structuredClone(unresolved)});
  const within = () => need(clock() < deadline, 'inventory_deadline');
  const gap = (code, key) => { if (!unresolved.some(row => row.code === code && row.keySha256 === hash(key))) unresolved.push({code, keySha256: hash(key)}); };
  async function head(key) { within(); const value = await storage.head(key); need(value && typeof value.found === 'boolean', 'inventory_head_invalid'); return value; }
  async function read(key, {required = true, expected = null, domain = 'raw', maxBytes = maxJsonBytes} = {}) {
    within(); need(scope.canRead(key), 'inventory_source_forbidden');
    const before = await head(key);
    if (!before.found) {
      need(sameIdentity(before, await head(key)), 'inventory_source_changed');
      heads.set(key, before); need(!required, 'inventory_reference_missing');
      return null;
    }
    need(integer(before.size) && before.size <= maxBytes && typeof before.etag === 'string' && before.etag, 'inventory_metadata_byte_limit');
    const record = await storage.get(key, {ifMatch: before.etag, versionId: before.versionId ?? null, maxBytes});
    need(record?.data instanceof Uint8Array && record.data.length === before.size && record.etag === before.etag
      && (before.versionId ?? null) === (record.versionId ?? null), 'inventory_get_identity');
    need(sameIdentity(before, await head(key)), 'inventory_source_changed');
    const sha256 = hash(record.data), value = decodeJson(record, maxBytes);
    need(!record.sha256 || record.sha256 === sha256, 'inventory_raw_hash');
    if (expected !== null) need(SHA.test(expected) && (domain === 'semantic' ? semanticHash(value) : sha256) === expected, 'inventory_reference_hash');
    if (heads.has(key)) need(sameIdentity(heads.get(key), before), 'inventory_source_changed');
    heads.set(key, before); ledger.addObject({key, ...before, sha256});
    return {value, sha256, semanticSha256: semanticHash(value), meta: before};
  }
  async function scan(prefix) {
    within(); need(scope.canList(prefix), 'inventory_list_scope');
    const prior = ledger.scan(prefix);
    if (prior) { need(prior.complete === 1, 'inventory_scan_incomplete'); return; }
    ledger.beginScan(prefix); let token = null;
    for (;;) {
      within(); const page = await storage.listPage(prefix, token);
      ledger.page(prefix, token, page);
      if (page.truncated === false) break;
      token = page.nextToken;
    }
  }
  function add(kind, root, parent, field, options = {}) {
    const target = scope.reference(kind, root);
    ledger.edge(parent, field, target, kind, options.expected ?? null, options.domain ?? null);
    const identity = kind + ':' + root + ':' + (options.expected ?? '');
    if (queued.has(identity)) return;
    queued.add(identity); queue.push({kind, root, parent, field, ...options});
    references.push({kind, root, ...(options.expected ? {expectedSha256: options.expected, hashDomain: options.domain ?? 'raw'} : {})});
  }
  function sourceRefs(row, parent, field) {
    need(object(row), 'inventory_source_descriptor');
    if (row.snapshotBinding !== undefined) {
      need(SHA.test(row.snapshotBinding), 'inventory_snapshot_binding');
      add('snapshot', 'catalog/provider-snapshots/che168/' + row.snapshotBinding, parent, field + '.snapshotBinding');
    }
    for (const name of ['replica', 'baseReplica']) if (row[name] !== undefined) {
      need(object(row[name]) && SHA.test(row[name].sha256 ?? ''), 'inventory_replica_descriptor');
      add('replica', row[name].key, parent, field + '.' + name, {expected: row[name].sha256, domain: 'semantic'});
    }
    if (row.workingJournal !== undefined) add('journal', row.workingJournal.key, parent, field + '.workingJournal');
  }
  function rawRef(value, parent, field) {
    need(object(value), 'inventory_raw_reference');
    const kinds = {'che168-snapshot': 'snapshot', 'che168-replica': 'replica', 'che168-journal': 'journal', 'nonjp-intake': 'intake'};
    const kind = kinds[value.kind];
    need(kind && patterns[kind].test(value.root ?? '') && (value.sha256 === undefined || SHA.test(value.sha256)), 'inventory_reference_scope');
    add(kind, value.root, parent, field, value.sha256 ? {expected: value.sha256, domain: 'semantic'} : {});
  }
  function receiptRefs(receipt, parent, field) {
    need(object(receipt) && receipt.version === 1 && receipt.market === 'china' && SHA.test(receipt.manifestSha256 ?? ''), 'inventory_intake_receipt');
    add('intake', receipt.root, parent, field + '.root', {expected: receipt.manifestSha256, domain: 'semantic'});
    if (receipt.handoff) {
      need(object(receipt.handoff) && receipt.handoff.version === 1 && Array.isArray(receipt.handoff.references), 'inventory_handoff_schema');
      add('pin', receipt.handoff.key, parent, field + '.handoff.key');
      receipt.handoff.references.forEach((ref, i) => rawRef(ref, parent, field + '.handoff.references.' + i));
    }
  }
  function reportRefs(report, parent) {
    need(object(report) && report.version === 1 && report.market === 'china' && Array.isArray(report.sources), 'inventory_report_schema');
    report.sources.forEach((row, i) => {
      if (row?.provider === 'auto_api_che168') sourceRefs(row, parent, 'sources.' + i);
      else gap('unresolved_china_source_schema', parent);
    });
    if (report.durableIntakeArchive) receiptRefs(report.durableIntakeArchive, parent, 'durableIntakeArchive');
    need(report.rawArchiveDependencies === undefined || Array.isArray(report.rawArchiveDependencies), 'inventory_report_schema');
    for (const [i, ref] of (report.rawArchiveDependencies ?? []).entries()) receiptRefs(ref, parent, 'rawArchiveDependencies.' + i);
    for (const name of ['sourceInputWitness', 'paidInputWitness']) if (report[name]) {
      const witness = report[name];
      if (witness.snapshot?.root && patterns.replica.test(witness.snapshot.root)) {
        need(SHA.test(witness.snapshot.completeSha256 ?? ''), 'inventory_witness_schema');
        add('replica', witness.snapshot.root, parent, name + '.snapshot', {expected: witness.snapshot.completeSha256, domain: 'semantic'});
      } else gap('unresolved_source_witness_schema', parent);
    }
  }
  function owned(value, parent) {
    need(object(value) && value.version === 1 && value.market === 'china' && RUN.test(value.runId ?? ''), 'inventory_owned_schema');
    const runRoot = OWNED + '/runs/' + value.runId;
    add('run', runRoot, parent, 'runId', {allowMissingComplete: value.status === 'fetching'});
    add('downloads', OWNED + '/downloads/' + value.runId, parent, 'runId.downloadReceipts');
    if (value.previousRun !== undefined && value.previousRun !== null) {
      need(RUN.test(value.previousRun), 'inventory_owned_schema');
      sourceRuns.set(value.runId, value.previousRun);
      let next = value.runId; const seen = new Set();
      while (sourceRuns.has(next)) { need(!seen.has(next), 'inventory_source_run_cycle'); seen.add(next); next = sourceRuns.get(next); }
      add('run', OWNED + '/runs/' + value.previousRun, parent, 'previousRun');
    }
    for (const [field, item] of [['base', value.base], ['', value]]) if (item?.archiveRoot !== undefined) {
      need(SHA.test(item.archiveSha256 ?? ''), 'inventory_owned_archive');
      add('intake', item.archiveRoot, parent, (field ? field + '.' : '') + 'archiveRoot', {expected: item.archiveSha256, domain: 'semantic'});
    }
    if (value.rateRun !== undefined) { need(RUN.test(value.rateRun), 'inventory_rate_run'); add('rates', 'catalog/feed-rates/v1/china/' + value.rateRun + '.json', parent, 'rateRun'); }
  }
  async function stage(ref) {
    const key = ref.root + '/READY.json';
    const ready = (await read(key, {expected: ref.expected})).value;
    need(ready.version === 1 && ready.kind === 'china-private-durable-stage-ready-v1' && ready.market === 'china'
      && ready.stageRoot === ref.root + '/' && ready.runId === ref.root.split('/').at(-1) && GEN.test(ready.generationId ?? '')
      && ready.generationId === ref.generationId && [ready.runtimeReadySha256, ready.manifestSha256, ready.activeControlSha256,
        ready.pricingReceiptSha256, ready.archiveSha256].every(value => SHA.test(value ?? '')), 'inventory_stage_ready_schema');
    stageArchiveDigests.add(ready.archiveSha256);
    await scan(ref.root + '/');
    const runtimeKey = ref.root + '/runtime-ready.json', runtime = (await read(runtimeKey, {expected: ready.runtimeReadySha256})).value;
    need(runtime.version === 1 && runtime.kind === 'china-isolated-runtime-ready' && runtime.generationId === ready.generationId
      && ['manifestSha256', 'activeControlSha256', 'pricingReceiptSha256', 'archiveSha256'].every(field => runtime[field] === ready[field]), 'inventory_stage_runtime_schema');
    // Historical validity timestamps are preserved, not used to discard backup dependencies.
    const local = ref.root + '/objects/catalog/market-activation-fixture-v1/china/';
    const state = (await read(local + 'control.json', {expected: ready.activeControlSha256})).value;
    need(state.version === 1 && state.market === 'china' && state.active?.generationId === ready.generationId
      && state.active?.manifestSha256 === ready.manifestSha256, 'inventory_stage_control_schema');
    const generation = local + 'generations/' + ready.generationId + '/';
    const binding = (await read(generation + 'binding.json')).value;
    need(binding.version === 1 && binding.market === 'china' && binding.generationId === ready.generationId
      && binding.manifestSha256 === ready.manifestSha256, 'inventory_stage_binding');
    const cutKey = generation + 'ready-' + ready.manifestSha256 + '.json';
    const cut = (await read(cutKey, {expected: ready.manifestSha256})).value;
    need(cut.version === 1 && cut.market === 'china' && cut.generationId === ready.generationId && object(cut.papers)
      && ['inventory', 'prices', 'search'].every(role => SHA.test(cut.papers[role] ?? '')), 'inventory_stage_cut_schema');
    for (const role of ['inventory', 'prices', 'search']) {
      const paperKey = generation + role + '-' + cut.papers[role] + '.json';
      const paper = (await read(paperKey, {expected: cut.papers[role]})).value;
      need(paper.version === 1 && paper.role === role && paper.market === 'china' && paper.generationId === ready.generationId, 'inventory_stage_paper_schema');
      ledger.edge(cutKey, 'papers.' + role, paperKey, 'stage-paper', cut.papers[role], 'raw');
      if (role === 'prices') {
        const manifest = paper.payload?.manifest, marker = manifest?.markets?.china?.preparedChinaPriceReadV1;
        need(manifest?.version === 2 && manifest.generationId === ready.generationId && SHA.test(marker?.directorySha256 ?? ''), 'inventory_stage_prepared_manifest');
        const directory = generation + 'prepared/indexes/prepared-china-read-v1/directory-' + marker.directorySha256 + '.json';
        const value = (await read(directory, {expected: marker.directorySha256})).value;
        need(value.version === 1 && value.generationId === ready.generationId && Array.isArray(value.chunkSha256)
          && Array.isArray(manifest.markets.china.chunks) && value.chunkSha256.length === manifest.markets.china.chunks.length, 'inventory_stage_directory');
        ledger.edge(paperKey, 'payload.manifest.markets.china.preparedChinaPriceReadV1', directory, 'stage-directory', marker.directorySha256, 'raw');
      }
    }
  }
  async function process(ref) {
    const {kind, root, expected, domain} = ref;
    if (kind === 'stage') return stage(ref);
    if (kind === 'generation') {
      // First operation discovers China source addresses. A full shared generation
      // sweep belongs to separately reviewed rollback backup, not this inventory.
      gap('legacy_generation_inventory_deferred', root);
      gap('legacy_shared_serving_aliases_require_separate_fence', root); return;
    }
    if (kind === 'downloads') { await scan(root + '/'); return; }
    if (kind === 'rates' || kind === 'pin' || kind === 'handoff') {
      const result = await read(root, {expected, domain});
      need(object(result.value) && result.value.version === 1, 'inventory_control_schema');
      if (kind === 'pin' && result.value.references) {
        need(Array.isArray(result.value.references), 'inventory_pin_schema');
        result.value.references.forEach((value, i) => rawRef(value, root, 'references.' + i));
      }
      if (kind === 'handoff' && result.value.handoff) {
        const handoff = result.value.handoff; add('pin', handoff.key, root, 'handoff.key');
      }
      return;
    }
    const file = kind === 'run' || kind === 'intake' ? '/complete.json' : kind === 'journal' ? '/head.json' : '/manifest.json';
    const key = root + file;
    const result = await read(key, {required: !(kind === 'run' && ref.allowMissingComplete), expected, domain});
    await scan(root + '/');
    if (!result) { gap('incomplete_saved_run', root); return; }
    const value = result.value;
    if (kind === 'run') {
      need(value.status === 'complete', 'inventory_run_not_complete'); owned(value, key); return;
    }
    if (kind === 'snapshot' || kind === 'replica') {
      need(value.version === 1 && SHA.test(value.binding ?? '') && Array.isArray(value.parts) && value.parts.length > 0, 'inventory_binary_manifest');
      if (kind === 'snapshot') need(value.complete === true && root.endsWith('/' + value.binding), 'inventory_snapshot_manifest');
      for (const [index, part] of value.parts.entries()) {
        need(object(part) && integer(part.bytes) && SHA.test(part.sha256 ?? ''), 'inventory_binary_part_descriptor');
        const name = kind === 'snapshot' ? String(index).padStart(5, '0') + '.csv.gz' : index + '.gz';
        const child = root + '/' + name;
        need(ledger.object(child), 'inventory_referenced_part_missing');
        ledger.edge(key, 'parts.' + index, child, kind + '-part', part.sha256, 'decoded');
        if (kind === 'snapshot') need(ledger.object(root + '/' + String(index).padStart(5, '0') + '.json'), 'inventory_snapshot_sidecar_missing');
      }
    } else if (kind === 'journal') {
      need([1, 2].includes(value.version) && SHA.test(value.binding ?? '') && Array.isArray(value.chunks), 'inventory_journal_schema');
      for (const [index, chunk] of value.chunks.entries()) {
        need(new RegExp('^' + UUID + '$').test(chunk?.id ?? '') && SHA.test(chunk.sha ?? ''), 'inventory_journal_chunk');
        const child = root + '/' + chunk.id + '.json'; need(ledger.object(child), 'inventory_referenced_part_missing');
        ledger.edge(key, 'chunks.' + index, child, 'journal-chunk', chunk.sha, 'semantic');
      }
    } else if (kind === 'intake') {
      need(value.version === 1 && value.kind === 'nonjp-intake' && value.market === 'china' && Array.isArray(value.files)
        && SHA.test(value.reportDigest ?? ''), 'inventory_archive_schema');
      archiveDigests.add(result.semanticSha256);
      const names = new Set(); let total = 0; let reportFile;
      for (const [fileIndex, item] of value.files.entries()) {
        need(object(item) && (item.name === 'report.json' || /^[a-z0-9_-]+-\d{6,}\.jsonl$/i.test(item.name ?? ''))
          && !names.has(item.name) && integer(item.bytes) && SHA.test(item.sha256 ?? '') && Array.isArray(item.parts)
          && item.parts.length === Math.ceil(item.bytes / (2 * 1024 * 1024)), 'inventory_archive_file');
        names.add(item.name); total += item.bytes;
        for (const [index, part] of item.parts.entries()) {
          need(SHA.test(part?.sha256 ?? '') && part.key === root + '/files/' + item.name + '/' + index + '-' + part.sha256 + '.json'
            && part.bytes === Math.min(2 * 1024 * 1024, item.bytes - index * 2 * 1024 * 1024), 'inventory_archive_part');
          need(ledger.object(part.key), 'inventory_referenced_part_missing');
          ledger.edge(key, 'files.' + fileIndex + '.parts.' + index, part.key, 'intake-part', part.sha256, 'decoded');
        }
        if (item.name === 'report.json') reportFile = item;
      }
      need(Number.isSafeInteger(total) && total === value.totalBytes && reportFile && reportFile.sha256 === value.reportDigest
        && reportFile.bytes > 0 && reportFile.bytes <= maxJsonBytes, 'inventory_archive_report');
      const buffers = [];
      for (const part of reportFile.parts) {
        const envelope = (await read(part.key)).value;
        need(envelope.version === 1 && envelope.encoding === 'gzip-base64' && envelope.bytes === part.bytes
          && envelope.sha256 === part.sha256 && typeof envelope.payload === 'string', 'inventory_archive_envelope');
        const encoded = Buffer.from(envelope.payload, 'base64');
        need(encoded.toString('base64') === envelope.payload, 'inventory_archive_base64');
        let bytes; try { bytes = gunzipSync(encoded, {maxOutputLength: 2 * 1024 * 1024}); } catch { throw new InventoryError('inventory_archive_compression'); }
        need(bytes.length === part.bytes && hash(bytes) === part.sha256, 'inventory_archive_report_part_hash'); buffers.push(bytes);
      }
      const reportBytes = Buffer.concat(buffers);
      need(reportBytes.length === reportFile.bytes && hash(reportBytes) === value.reportDigest, 'inventory_archive_report_hash');
      reportRefs(decodeJson({data: reportBytes}, maxJsonBytes), key);
      const mapping = 'catalog/raw-feed-handoffs/v1/nonjp-intake/' + semanticHash(root) + '.json';
      scope.reference('handoff', mapping);
      const handoff = await read(mapping, {required: false});
      if (handoff) add('handoff', mapping, key, 'derivedHandoffMapping');
    }
  }

  const values = new Map();
  for (const root of FIXED_ROOTS) {
    const result = await read(root.key, {required: root.required}); values.set(root.key, result?.value ?? null);
    roots.push({key: root.key, found: Boolean(result), ...(result ? {bytes: result.meta.size, sha256: result.sha256,
      etagSha256: hash(result.meta.etag), versioned: result.meta.versionId !== null && result.meta.versionId !== undefined,
      schemaVersion: integer(result.value?.version) ? result.value.version : null,
      knownFieldsPresent: ['market', 'active', 'previous', 'runId', 'previousRun', 'base', 'archiveRoot', 'archiveSha256',
        'rateRun', 'sources', 'binding', 'config', 'generationId', 'markets', 'roots', 'pointers', 'claims']
        .filter(field => object(result.value) && Object.hasOwn(result.value, field))} : {})});
    await progress('fixed_roots');
  }
  const protectedHeads = [];
  for (const key of PROTECTED_HEADS) {
    const value = await head(key); heads.set(key, value);
    protectedHeads.push({key, found: value.found, ...(value.found ? {bytes: value.size, etagSha256: hash(value.etag)} : {})});
  }
  const publicState = values.get(CONTROL);
  if (publicState) {
    need(publicState.version === 1 && publicState.market === 'china' && integer(publicState.revision) && publicState.revision > 0, 'inventory_china_control_schema');
    for (const field of ['active', 'previous']) {
      const target = publicState[field];
      if (field === 'previous' && target === null) continue;
      need(object(target) && GEN.test(target.generationId ?? ''), 'inventory_china_target_schema');
      if (target.kind === 'legacy-unmodified') {
        need(SHA.test(target.manifestSha256 ?? ''), 'inventory_legacy_target');
        const candidates = FIXED_ROOTS.filter(root => ['catalog/manifest.json', 'catalog/previous-manifest.json'].includes(root.key));
        const matched = candidates.find(root => values.get(root.key)?.generationId === target.generationId
          && roots.find(row => row.key === root.key)?.sha256 === target.manifestSha256);
        if (!matched) gap('legacy_manifest_address_unresolved', CONTROL);
        add('generation', 'catalog/generations/' + target.generationId, CONTROL, field);
      } else {
        need(/^[a-z0-9][a-z0-9-]{4,63}$/.test(target.runId ?? '') && SHA.test(target.readySha256 ?? ''), 'inventory_china_target_schema');
        add('stage', 'catalog/private-market-stage-v1/china/' + target.runId, CONTROL, field,
          {expected: target.readySha256, generationId: target.generationId});
      }
    }
  } else gap('independent_china_control_absent', CONTROL);
  for (const key of [OWNED + '/source.json', OWNED + '/prepared.json']) if (values.get(key)) owned(values.get(key), key);
  const cursorKey = 'catalog/intake-cursors/v1/china.json', cursor = values.get(cursorKey);
  if (cursor) {
    need(cursor.version === 1 && cursor.market === 'china' && Array.isArray(cursor.sources), 'inventory_cursor_schema');
    cursor.sources.forEach((row, i) => { if (row?.provider === 'auto_api_che168') sourceRefs(row, cursorKey, 'sources.' + i); });
  }
  const config = values.get(CONFIG);
  if (config) { need(config.version === 1 && SHA.test(config.binding ?? ''), 'inventory_snapshot_config'); add('snapshot', 'catalog/provider-snapshots/che168/' + config.binding, CONFIG, 'binding'); }
  for (const key of ['catalog/manifest.json', 'catalog/previous-manifest.json']) {
    const value = values.get(key); if (!value) continue;
    need(value.version === 2 && GEN.test(value.generationId ?? '') && object(value.markets), 'inventory_catalog_schema');
    // The independent reader never falls back to legacy on failure. Only unresolved
    // or explicit legacy mode requires its full shared serving dependency fence.
    if (!publicState || publicState.active?.kind === 'legacy-unmodified') add('generation', 'catalog/generations/' + value.generationId, key, 'generationId');
  }
  const rawState = values.get(RAW_STATE);
  if (rawState) {
    need(rawState.version === 1 && object(rawState), 'inventory_coordination_schema');
    // Shared authority is captured as evidence. It must not expand unrelated markets
    // or be used to acquire pins, resume pending operations or authorize publication.
    gap('shared_coordination_evidence_not_restorable', RAW_STATE);
  }
  for (let index = 0; index < queue.length; index++) { within(); await progress('resolving_' + queue[index].kind); await process(queue[index]); }
  for (const digest of stageArchiveDigests) if (!archiveDigests.has(digest)) gap('stage_archive_digest_has_no_resolved_storage_address', digest);
  for (const [key, before] of heads) need(sameIdentity(before, await head(key)), 'inventory_root_vector_changed');
  const totals = ledger.summary();
  need(totals.scans.every(scan => scan.complete), 'inventory_scan_incomplete');
  return {version: 1, kind: 'china-readonly-dependency-inventory', inventoryReadCompleted: true,
    contentBackupComplete: false, fullAllMarketBackup: false, deletionAllowed: false, productionWrites: false,
    servingSchemaSha: SERVING_SCHEMA_SHA, sourceSchemaSha: SOURCE_SCHEMA_SHA, serving,
    startedAt, completedAt: new Date(clock()).toISOString(), storageScopeSha256: storage.scopeFingerprint ?? null,
    roots, protectedHeads, references, unresolved, totals, rootVectorStable: true,
    limitations: ['LIST and metadata enumeration is not content backup or restore verification.',
      'Root stability is a drift check, not a multi-object transaction or complete writer fence.',
      'Historical TTL, year, admission and fleet caps do not exclude backup dependencies.',
      'Authority, leases, controls and pending claims are evidence only; never restore them automatically.']};
}

export async function main(env = process.env) {
  const output = env.CHINA_INVENTORY_REPORT_PATH;
  need(typeof output === 'string' && path.isAbsolute(output), 'inventory_output_path');
  const serving = {releaseSha: env.CHINA_INVENTORY_SERVING_RELEASE_SHA,
    calculationVersion: env.CHINA_INVENTORY_CALCULATION_VERSION};
  const scope = createInventoryScope(), ledger = new InventoryLedger(env.RUNNER_TEMP || undefined);
  let report, successful = false, observed = null;
  try {
    const storage = createInventoryStorage({env, scope});
    report = await inventoryChina({storage, scope, ledger, serving, onProgress: value => { observed = value; }});
    successful = true;
  } catch (error) {
    report = {version: 1, kind: 'china-readonly-dependency-inventory', inventoryReadCompleted: false,
      contentBackupComplete: false, fullAllMarketBackup: false, deletionAllowed: false, productionWrites: false,
      errorCode: safeError(error), observed, totals: ledger.summary()};
  }
  try {
    await fs.mkdir(path.dirname(output), {recursive: true, mode: 0o700});
    await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    if (env.CHINA_INVENTORY_PRIVATE_LEDGER_PATH) {
      need(path.isAbsolute(env.CHINA_INVENTORY_PRIVATE_LEDGER_PATH), 'inventory_output_path');
      ledger.exportPrivate(env.CHINA_INVENTORY_PRIVATE_LEDGER_PATH);
    }
  } finally { ledger.close(); }
  console.log(JSON.stringify({inventoryReadCompleted: successful, contentBackupComplete: false, deletionAllowed: false,
    objects: report.totals.objects, bytes: report.totals.bytes, ...(successful ? {unresolved: report.unresolved.length} : {errorCode: report.errorCode})}));
  return successful ? 0 : 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await main(); } catch (error) { console.error(safeError(error)); process.exitCode = 1; }
}
