import assert from 'node:assert/strict';
import {RAW_PREFIXES, rawRootKind, rawReferences, rawDigest, assertRawGenerationProvenance,
  rawGenerationProvenanceHasCompleteCoverage, assertRawPin} from './catalog-raw-provenance.mjs';
import {snapshotBinding} from './che168-snapshot.mjs';
import {validateIntakeArchive} from './nonjp-intake-archive.mjs';

const SHA = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const bytes = rows => rows.reduce((sum, row) => sum + row.size, 0);

function groupForObject(key) {
  assert.ok(typeof key === 'string' && !/[\\\x00-\x20]/.test(key), 'raw_inventory_key');
  for (const [kind, prefix] of Object.entries(RAW_PREFIXES)) {
    if (!key.startsWith(prefix)) continue;
    const parts = key.slice(prefix.length).split('/'), segments = kind === 'nonjp-intake' ? 3 : kind === 'encar-snapshot' ? 2 : 1;
    const root = prefix + parts.slice(0, segments).join('/'), leaf = parts.slice(segments).join('/');
    assert.equal(rawRootKind(root), kind, 'raw_inventory_root');
    const allowed = {
      'che168-snapshot': /^(?:manifest\.json|\d{5}\.(?:json|csv\.gz))$/,
      'che168-replica': /^(?:manifest\.json|\d+\.gz)$/,
      'che168-journal': /^(?:head\.json|[a-f0-9-]{36}\.json)$/,
      'encar-snapshot': /^(?:start\.json|complete\.json|(?:pages|page-receipts)\/[1-9]\d*\.json)$/,
      'encar-recovery-spool': /^(?:complete\.json|chunks\/[1-9]\d*\/(?:data|commit)\.json)$/,
      'encar-reports': /^(?:complete\.json|(?:history|inspection)\/[a-f0-9]{2,3}\.json)$/,
      'nonjp-intake': /^(?:complete\.json|files\/(?:report\.json|[a-z0-9_-]+-[0-9]{6}\.jsonl)\/[0-9]+-[a-f0-9]{64}\.json)$/i,
    }[kind];
    assert.ok(allowed.test(leaf), 'raw_inventory_unknown_member');
    return {kind, root, leaf};
  }
  throw Error('raw_inventory_outside_scope');
}

/** A complete receipt, not age or a folder name, proves a finished immutable group. */
function completeGroup(group, terminalRoots) {
  const value = group.receipt, keys = new Set(group.objects.map(row => row.leaf));
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  // Recovery transport is never a retirement witness; keep every spool protected.
  if(group.kind==='encar-recovery-spool')return false;
  let expected;
  if (group.kind === 'che168-snapshot') {
    try { if (snapshotBinding(value.config) !== value.binding) return false; } catch { return false; }
    if (value.version !== 1 || value.complete !== true || value.binding !== group.root.split('/').at(-1)
      || !Array.isArray(value.parts) || !value.parts.length || value.parts.length > 1280
      || value.parts.length !== Math.ceil(value.config.bytes / (16 * 1024 * 1024))
      || value.parts.some((row, index) => row.index !== index || row.bytes !== Math.min(16 * 1024 * 1024, value.config.bytes - index * 16 * 1024 * 1024)
        || !SHA.test(row.sha256))) return false;
    expected = ['manifest.json', ...value.parts.flatMap((_, index) => [String(index).padStart(5, '0') + '.json', String(index).padStart(5, '0') + '.csv.gz'])];
  } else if (group.kind === 'che168-replica') {
    if (value.version !== 1 || !SHA.test(value.binding) || !integer(value.cursor)
      || !Array.isArray(value.parts) || !value.parts.length || value.parts.length > 1024
      || value.parts.some(row => !integer(row.bytes) || row.bytes <= 0 || row.bytes > 16 * 1024 * 1024 || !SHA.test(row.sha256))
      || value.parts.reduce((sum, row) => sum + row.bytes, 0) !== value.bytes) return false;
    expected = ['manifest.json', ...value.parts.map((_, index) => index + '.gz')];
  } else if (group.kind === 'che168-journal') {
    // Journals have mutable heads: even a valid head is not a terminal receipt.
    if (!terminalRoots.has(group.root) || value.version !== 2 || !SHA.test(value.binding)
      || !integer(value.cursor) || !integer(value.initialCursor) || value.cursor < value.initialCursor
      || !Array.isArray(value.chunks) || value.chunks.length > 10000
      || value.chunks.some(row => !UUID.test(row.id) || !SHA.test(row.sha))) return false;
    return keys.has('head.json') && value.chunks.every(row => keys.has(row.id + '.json'));
  } else if (group.kind === 'encar-snapshot') {
    const [run, attempt] = group.root.slice(RAW_PREFIXES['encar-snapshot'].length).split('/');
    if (value.version !== 1 || value.provider !== 'auto_api_encar' || value.runId !== run || value.attempt !== attempt
      || !integer(value.pages) || value.pages < 1 || value.pages > 100000 || !integer(value.count) || value.count < 1
      || !Number.isFinite(Date.parse(value.completedAt))) return false;
    expected = ['start.json', 'complete.json', ...Array.from({length: value.pages}, (_, index) => ['pages/' + (index + 1) + '.json', 'page-receipts/' + (index + 1) + '.json']).flat()];
  } else if (group.kind === 'encar-reports') {
    if (value.version !== 1 || value.provider !== 'auto_api_encar'
      || String(value.observedAtMs) !== group.root.slice(RAW_PREFIXES['encar-reports'].length)
      || Date.parse(value.observedAt) !== value.observedAtMs || ![2, 3].includes(value.bucketPrefixLength)
      || rawRootKind(RAW_PREFIXES['encar-snapshot'] + value.sourceRunId + '/' + value.sourceRunAttempt) !== 'encar-snapshot'
      || !integer(value.rowCount) || value.rowCount <= 0) return false;
    expected = ['complete.json'];
    let prior;
    for (const kind of ['history', 'inspection']) {
      const table = value[kind];
      if (!table || typeof table !== 'object' || Array.isArray(table)) return false;
      const prefixes = Object.keys(table).sort();
      if (!prefixes.length || prefixes.length > 4096 || prior && rawDigest(prefixes) !== rawDigest(prior)) return false;
      if (prefixes.some(prefix => !new RegExp('^[a-f0-9]{' + value.bucketPrefixLength + '}$').test(prefix)
        || !integer(table[prefix]?.count) || table[prefix].count < 1 || table[prefix].count > 2048 || !SHA.test(table[prefix].sha256))) return false;
      if (prefixes.reduce((sum, prefix) => sum + table[prefix].count, 0) !== value.rowCount) return false;
      expected.push(...prefixes.map(prefix => kind + '/' + prefix + '.json')); prior = prefixes;
    }
  } else if (group.kind === 'nonjp-intake') {
    try { validateIntakeArchive(value, group.root, rawDigest(value)); } catch { return false; }
    expected = ['complete.json', ...value.files.flatMap(file => file.parts.map(part => part.key.slice(group.root.length + 1)))];
  }
  return expected?.length === keys.size && expected.every(key => keys.has(key));
}

// The bounded executor reuses this exact member/receipt protocol. These pure
// exports neither establish writer coverage nor authorize a storage mutation.
export {groupForObject as rawInventoryGroupForObject, completeGroup as completeRawInventoryGroup};

/** Pure plan only. No object-store writes or delete API are exposed here.
 * The future inventory runner must establish full producer pin coverage first.
 * An expired loading pin remains live until its producer closes it explicitly.
 */
export function planRawFeedRetention({inventory, pinInventory, cursorInventory, producerProtocolComplete,
  currentManifest, previousManifest, currentProvenance, previousProvenance,
  now = Date.now(), graceMs = 86400000, maxGroups = 2, maxObjects = 20000, maxBytes = 10 * 1024 ** 3}) {
  assert.ok(inventory?.complete === true && pinInventory?.complete === true && cursorInventory?.complete === true, 'raw_inventory_incomplete');
  assert.deepEqual([...(inventory.prefixes || [])].sort(), Object.values(RAW_PREFIXES).sort(), 'raw_inventory_prefixes_incomplete');
  assert.ok(Number.isFinite(now) && Number.isSafeInteger(graceMs) && graceMs >= 86400000, 'raw_retention_time_guard');
  assert.ok(integer(maxGroups) && maxGroups > 0 && maxGroups <= 10 && integer(maxObjects) && maxObjects > 0 && maxObjects <= 250000
    && integer(maxBytes) && maxBytes > 0 && maxBytes <= 100 * 1024 ** 3, 'raw_retention_budget');
  assert.ok(Array.isArray(inventory.objects) && inventory.objects.length <= 500000
    && Array.isArray(pinInventory.pins) && pinInventory.pins.length <= 10000, 'raw_inventory_limit');
  if (producerProtocolComplete !== true || !rawGenerationProvenanceHasCompleteCoverage(currentProvenance, currentManifest)
    || !rawGenerationProvenanceHasCompleteCoverage(previousProvenance, previousManifest)) {
    return {selected: [], summary: {version: 1, mode: 'plan', status: 'protected_unknown', at: new Date(now).toISOString(),
      reason: producerProtocolComplete !== true ? 'raw_producer_protocol_incomplete' : 'raw_generation_provenance_missing_or_unknown',
      currentGeneration: currentManifest?.generationId || null, previousGeneration: previousManifest?.generationId || null,
      selectedGroups: [], selectedObjects: 0, selectedBytes: 0, candidateGroups: null, candidateObjects: null,
      selectionDigest: rawDigest([])}};
  }
  const references = rawReferences([...assertRawGenerationProvenance(currentProvenance, currentManifest),
    ...assertRawGenerationProvenance(previousProvenance, previousManifest), ...rawReferences(cursorInventory.references)]);
  const protectedRoots = new Set(references.map(row => row.root)), terminalRoots = new Set(), abandonedRoots = new Set(), pinIds = new Set();
  for (const pin of pinInventory.pins) {
    assertRawPin(pin);
    assert.ok(Date.parse(pin.updatedAt) <= now, 'raw_pin_future_state');
    assert.ok(!pinIds.has(pin.operationId), 'raw_duplicate_pin'); pinIds.add(pin.operationId);
    for (const {root} of pin.references) {
      if (['loading', 'ready'].includes(pin.state)) protectedRoots.add(root);
      else terminalRoots.add(root);
      if (pin.state === 'abandoned') abandonedRoots.add(root);
    }
  }
  const groups = new Map(), seen = new Set();
  for (const row of inventory.objects) {
    const {kind, root, leaf} = groupForObject(row.key);
    assert.ok(!seen.has(row.key) && integer(row.size), 'raw_inventory_duplicate_or_size'); seen.add(row.key);
    const group = groups.get(root) || {kind, root, objects: [], receipt: inventory.receipts?.[root] || null};
    group.objects.push({key: row.key, size: row.size, lastModified: row.lastModified, leaf}); groups.set(root, group);
  }
  for (const ref of references) {
    const group = groups.get(ref.root);
    assert.ok(group?.objects.length, 'raw_protected_group_missing');
    if (ref.sha256) assert.equal(rawDigest(group.receipt), ref.sha256, 'raw_protected_receipt_changed');
  }
  const closed = [], unprovenRoots = [], readerProtected = [];
  for (const group of groups.values()) {
    // Current/previous catalogue references do not cover a request still
    // reading an older report after two cutovers. Until the installed reader
    // participates in coordination, preserve every report root regardless of
    // receipt age, terminal producer pins or a caller's coverage flag.
    if(group.kind==='encar-reports') {
      protectedRoots.add(group.root);
      readerProtected.push({root:group.root,kind:group.kind,status:'protected_unknown',reason:'vm_report_reader_unfenced'});
    }
    group.objects.sort((a, b) => a.key.localeCompare(b.key));
    group.bytes = bytes(group.objects);
    const timestamps = group.objects.map(row => Date.parse(row.lastModified || ''));
    group.latest = timestamps.every(at => Number.isFinite(at) && at > 0) ? timestamps.reduce((latest, at) => Math.max(latest, at), 0) : now;
    const complete = completeGroup(group, terminalRoots);
    if (!complete && !abandonedRoots.has(group.root)) { unprovenRoots.push(group.root); continue; }
    closed.push(group);
  }
  // Retain two complete recent groups per kind in addition to all reachability pins.
  for (const kind of Object.keys(RAW_PREFIXES)) closed.filter(group => group.kind === kind)
    .sort((a, b) => b.latest - a.latest || a.root.localeCompare(b.root)).slice(0, 2).forEach(group => protectedRoots.add(group.root));
  const candidates = closed.filter(group => !protectedRoots.has(group.root) && group.latest < now - graceMs)
    .sort((a, b) => a.latest - b.latest || a.root.localeCompare(b.root));
  const selectedGroups = [];
  let objectCount = 0, selectedBytes = 0;
  for (const group of candidates) {
    if (selectedGroups.length >= maxGroups) break;
    // Whole groups only; a budget may defer a large group but never truncate it.
    if (objectCount + group.objects.length > maxObjects || selectedBytes + group.bytes > maxBytes) continue;
    selectedGroups.push(group); objectCount += group.objects.length; selectedBytes += group.bytes;
  }
  const selected = selectedGroups.flatMap(group => group.objects.map(({key, size, lastModified}) => ({key, size, lastModified, kind: group.kind, root: group.root})));
  const fenceDigest = rawDigest({currentManifest, previousManifest, currentProvenance, previousProvenance, cursorInventory,
    pins: [...pinInventory.pins].sort((a, b) => a.operationId.localeCompare(b.operationId)),
    objects: [...inventory.objects].sort((a, b) => a.key.localeCompare(b.key)), receipts: inventory.receipts});
  return {selected, summary: {version: 1, mode: 'plan', status: 'ready', at: new Date(now).toISOString(),
    maxGroups, maxObjects, maxBytes, graceMs, protectedRoots: [...protectedRoots].sort(), unprovenRoots: unprovenRoots.sort(),
    readerProtected:readerProtected.sort((a,b)=>a.root.localeCompare(b.root)),
    candidateGroups: candidates.length, candidateObjects: candidates.reduce((sum, group) => sum + group.objects.length, 0),
    selectedGroups: selectedGroups.map(group => group.root), selectedObjects: objectCount, selectedBytes,
    fenceDigest, selectionDigest: rawDigest(selected)}};
}
