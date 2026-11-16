import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

export const PINS = Object.freeze({
  live: '83ff17075e9188dcf227c8752dc064248d5f42e0',
  liveCalculator: '4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90',
  candidate: 'e8462585e8998eaae5a003831a38d79263ca5649',
  tree: 'c9919c21927ba5f303524569a4df99ca0174a710',
  calculator: '2a0a3eecd966a1c6a5ffed3760740983803ff172fcf023fc30aefbc102a6e4f2',
  generation: 'gen_1794665184205_cfd76b47',
  manifest: 'ca1cb45032cca15fbc5c9f4456fb0e1fab35893c3f9bff564aba5d39752c0f38',
  encyclopedia: 'bf2c72cb7a260ef093c0a43c2b0dad9c4c9094a4d6dc3811dd0d7f7626b0d72b',
  encyclopediaManifest: '8654f53db18b4cdb0a1a29960f030231618190b3c17b49a93630f2a2ccfa0b01',
  candidateBinding: '562e008895e2a51c7fd2151780673e9d414e8e1fb1544604f8446c21c82817a5',
});
export const LIMITS = Object.freeze({requests: 768, totalBytes: 768 * 1024 ** 2,
  objectBytes: 256 * 1024 ** 2, milliseconds: 15 * 60000, cardBlocks: 128,
  uaeRows: 30000, rootRows: 1000000, detailRows: 256, reportBytes: 32 * 1024 ** 2});
const endpoint = 'https://s3.regru.cloud';
const bucket = 'avtocena-staging-8120751';
const storagePrefix = 'migration-staging/full-20261011/';
const healthUrl = 'https://avtocena.com/api/health';
const base = `catalog/generations/${PINS.generation}/indexes/`;
const projectionKey = base + 'projection/uae.json';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bytesHash = value => createHash('sha256').update(value).digest('hex');
const projectionScope = bytesHash(projectionKey);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const day = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
function check(ok, code) { if (!ok) {const error = Error(code); error.auditCode = code; throw error;} }
const failure = error => typeof error?.auditCode === 'string' ? error.auditCode : 'uae_audit_read_failed';

export function allowedStorageKey(key) {
  return ['catalog/manifest.json', 'catalog/import-lock.json', 'catalog/operations/collection-controls-v1.json',
    'catalog-editorial/current.json',
    projectionKey, base + 'budget-count-v3.json', base + 'budget-markets-v3/ready.json',
    base + 'budget-markets-v3/uae.json', `knowledge/encyclopedia/calculation-indexes/${PINS.encyclopedia}.json`,
    `knowledge/encyclopedia/calculation-releases/${PINS.live}.json`,
    `knowledge/encyclopedia/calculation-releases/${PINS.candidate}.json`].includes(key)
    || new RegExp(`^${base}budget-markets-v3/parts/uae/[a-f0-9]{64}\\.json$`).test(key)
    || new RegExp(`^${base}projection-parts/${projectionScope}/[0-9]+-[a-f0-9]{64}\\.json$`).test(key)
    || new RegExp(`^${base}budget-cards-v3/[0-9]{1,6}\\.json$`).test(key);
}

/** No supplier, CBR, search endpoint, arbitrary bucket, listing or mutation. */
export function installReadOnlyNetwork(fetchImpl = fetch, {limits = LIMITS, now = Date.now} = {}) {
  const started = now(), stats = {requests: 0, bytes: 0, writes: 0, supplierRequests: 0};
  const remaining = () => {const left = limits.milliseconds - (now() - started); check(left > 0, 'uae_audit_time_budget'); return left;};
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const method = String(options.method || input?.method || 'GET').toUpperCase();
    check(!url.search && !url.hash && !url.username && !url.password && ['GET', 'HEAD'].includes(method), 'uae_audit_network_forbidden');
    const fixedPrefix = `/${bucket}/${storagePrefix}`;
    const own = url.origin === endpoint && url.pathname.startsWith(fixedPrefix)
      && allowedStorageKey(url.pathname.slice(fixedPrefix.length));
    check(own || url.href === healthUrl && method === 'GET', 'uae_audit_network_forbidden');
    check(++stats.requests <= limits.requests, 'uae_audit_request_budget');
    const signal = AbortSignal.timeout(Math.min(45000, remaining()));
    const response = await fetchImpl(input, {...options, method, redirect: 'error',
      signal: options.signal ? AbortSignal.any([options.signal, signal]) : signal});
    if (!response.body || method === 'HEAD') return response;
    let objectBytes = 0;
    const body = response.body.pipeThrough(new TransformStream({transform(chunk, controller) {
      objectBytes += chunk.byteLength; stats.bytes += chunk.byteLength;
      check(objectBytes <= limits.objectBytes, 'uae_audit_object_budget');
      check(stats.bytes <= limits.totalBytes, 'uae_audit_byte_budget'); remaining(); controller.enqueue(chunk);
    }}));
    return new Response(body, {status: response.status, statusText: response.statusText, headers: response.headers});
  };
  return {stats, restore() {globalThis.fetch = fetchImpl;}};
}

export function forbidStorageWrites(storage) {
  for (const name of ['writeJson', 'putBinary', 'deleteJson', 'deleteBinary', 'deleteObjects', 'deletePrefix',
    'abortMultipartUpload', 'listObjects', 'listBucketObjects', 'listObjectVersions', 'listMultipartUploads'])
    if (typeof storage[name] === 'function') storage[name] = async () => {check(false, 'uae_audit_storage_mutation_forbidden');};
}

function safeFlags(row, runtime) {
  const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const positive = value => Number.isFinite(Number(value)) && Number(value) > 0;
  const token = value => typeof value === 'string' && /^[a-z0-9_-]{1,64}$/i.test(value) ? value : null;
  const age = runtime.age(row);
  return {year: finite(row.year), cardProjectionVersion: finite(row.cardProjectionVersion),
    sourceGroup: token(row.sourceGroup), hasImage: !!row.cardImageUrl, sourcePricePresent: positive(row.sourcePrice),
    totalPresent: positive(row.totalRub), publicVisiblePricePresent: positive(row.publicVisibleRub),
    sellerPricePresent: positive(row.sellerPriceRub), sellerMode: row.catalogPricingMode === 'seller',
    needsData: row.calculationStatus === 'needs_data', modificationSelection: !!row.modificationSelection,
    specificationVerified: row.publicSpecificationVerified === true,
    encyclopediaEvidence: !!row.encyclopediaCalculation, encyclopediaFields: Array.isArray(row.encyclopediaCalculation?.filledFields)
      ? row.encyclopediaCalculation.filledFields.filter(field => ['fuel','powertrainKind','engineCc','powerHp','powerKw','icePowerKw','power30MinKw','transmission','drive','bodyType','engineCode','grossVehicleWeightKg'].includes(field)) : [],
    ageEligible: age?.eligible === true, vehicleExcluded: runtime.excluded(row), reviewedDuplicate: runtime.duplicate(row),
    candidateRawRenderable: runtime.canRender(row), allDubicars: runtime.allDubicars(row), unpricedDubicars: runtime.unpricedDubicars(row),
    engineCc: finite(row.engineCc), powerHp: finite(row.powerHp), grossVehicleWeightKg: finite(row.grossVehicleWeightKg)};
}

/** Same strict independent-projection set relations as the release gate.
 * A diagnostic records missing IDs; it never treats missing coverage as ready. */
export function analyzeCoverage({manifest, projection, selector, rootIndex, runtime, limits = LIMITS}) {
  check(projection?.generationId === manifest.generationId && Array.isArray(projection.items)
    && projection.items.length === manifest.markets.uae.count && projection.items.length <= limits.uaeRows, 'uae_audit_projection_incomplete');
  const raw = new Map();
  for (const row of projection.items) {
    check(row?.market === 'uae' && validId(row.id) && !raw.has(row.id), 'uae_audit_projection_identity'); raw.set(row.id, row);
  }
  check(selector?.version === 3 && selector.generationId === manifest.generationId
    && Array.isArray(selector.rows) && Array.isArray(selector.otherRows), 'uae_audit_selector_invalid');
  const source = [...selector.rows, ...selector.otherRows], selected = new Map();
  check(selector.sourceRows === source.length, 'uae_audit_selector_count');
  for (const row of source) {
    check(row?.[0] === 'uae' && validId(row?.[5]?.id) && raw.has(row[5].id) && !selected.has(row[5].id), 'uae_audit_selector_identity');
    selected.set(row[5].id, row);
  }
  check(rootIndex?.version === 3 && rootIndex.generationId === manifest.generationId
    && Array.isArray(rootIndex.rows) && Array.isArray(rootIndex.otherRows), 'uae_audit_root_index_invalid');
  const rootRows = [...rootIndex.rows, ...rootIndex.otherRows];
  check(rootIndex.sourceRows === rootRows.length && rootRows.length <= limits.rootRows, 'uae_audit_root_index_count');
  const root = new Map(), rootIds = new Set();
  for (const row of rootRows) {
    check(validId(row?.[5]?.id) && !rootIds.has(row[5].id), 'uae_audit_root_identity'); rootIds.add(row[5].id);
    if (row[0] === 'uae') {check(raw.has(row[5].id) && integer(row[5].block), 'uae_audit_root_uae_identity'); root.set(row[5].id, row);}
  }
  const eligible = runtime.prepareRows(projection.items), eligibleIds = new Set();
  for (const row of eligible) {check(raw.has(row.id) && !eligibleIds.has(row.id), 'uae_audit_eligible_identity'); eligibleIds.add(row.id);}
  const missing = eligible.filter(row => !selected.has(row.id)).map((row, offset) => {
    const original = raw.get(row.id), rootRow = root.get(row.id);
    return {id: row.id, inRootIndex: !!rootRow, rootBlock: rootRow?.[5]?.block ?? null,
      ...(offset < limits.detailRows ? {original: safeFlags(original, runtime), prepared: safeFlags(row, runtime)} : {})};
  });
  return {generationId: manifest.generationId, market: 'uae', projectionRows: raw.size, selectorRows: selected.size,
    rootUaeRows: root.size, candidateEligibleRows: eligible.length, missingCount: missing.length,
    missingInRootCount: missing.filter(row => !row.inRootIndex).length, detailRows: Math.min(missing.length, limits.detailRows),
    sourceCoveragePassed: missing.length === 0, projectionIdsSha256: hash([...raw.keys()].sort()),
    selectorIdsSha256: hash([...selected.keys()].sort()), eligibleIdsSha256: hash([...eligibleIds].sort()),
    rootUaeIdsSha256: hash([...root.keys()].sort()), missingIdsSha256: hash(missing.map(row => row.id).sort()), missing};
}

/** The failed gate loads editorial for its fingerprint but does not enter the
 * request AsyncLocalStorage context. Keep that result separate from visitor
 * editorial admission, and bind this second result to the exact observed data. */
export async function analyzeEditorialCoverage(input, editorial, expected) {
  return editorial.withCatalogEditorial(async () => {
    check(editorial.editorialRevision() === expected.revision
      && hash(editorial.editorialEntries()) === hash(Object.values(expected.entries)), 'uae_audit_editorial_context_changed');
    return analyzeCoverage(input);
  });
}

export async function inspectReferencedCards(coverage, read, limits = LIMITS) {
  const blocks = [...new Set(coverage.missing.filter(row => row.inRootIndex).map(row => row.rootBlock))].sort((a,b) => a-b);
  const selected = blocks.slice(0, limits.cardBlocks), found = new Map();
  for (let offset = 0; offset < selected.length; offset += 4) {
    await Promise.all(selected.slice(offset, offset+4).map(async block => {
      const part = await read(base + `budget-cards-v3/${block}.json`);
      check(part?.generationId === PINS.generation && Array.isArray(part.items) && part.items.length <= 256, 'uae_audit_card_block_invalid');
      const ids = part.items.map(row => row?.id);
      check(ids.every(validId) && new Set(ids).size === ids.length, 'uae_audit_card_identity');
      found.set(block, new Set(ids));
    }));
  }
  for (const row of coverage.missing) row.cardMapping = row.rootBlock === null ? 'no_root_index_mapping'
    : !found.has(row.rootBlock) ? 'not_checked_within_bound'
    : found.get(row.rootBlock).has(row.id) ? 'exact_id_found' : 'referenced_block_missing_id';
  return {requiredBlocks: blocks.length, readBlocks: selected.length, complete: selected.length === blocks.length,
    exactIds: coverage.missing.filter(row => row.cardMapping === 'exact_id_found').length,
    wrongMappingIds: coverage.missing.filter(row => row.cardMapping === 'referenced_block_missing_id').length};
}

function assertSource(root) {
  const git = args => execFileSync('git', args, {cwd: root, encoding:'utf8', maxBuffer:32*1024**2}).trim();
  check(git(['rev-parse','HEAD']) === PINS.candidate && git(['rev-parse','HEAD^{tree}']) === PINS.tree
    && !git(['status','--porcelain','--untracked-files=no']), 'uae_audit_candidate_source_changed');
}
function freeLease(meta) {
  if (!meta.found) return;
  check(meta.etag && object(meta.value), 'uae_audit_lock_invalid');
  const until = meta.value.lockedUntil;
  check(until === '' || Number.isFinite(Date.parse(until)) && Date.parse(until) <= Date.now(), 'uae_audit_writer_busy');
}
export async function health() {
  for (let attempt=0; attempt<3; attempt++) {
    let response;
    try {response = await fetch(healthUrl, {headers:{'Cache-Control':'no-cache'}});}
    catch (error) {if (error?.auditCode || attempt === 2) throw error; continue;}
    if ([502,503,504].includes(response.status) && attempt<2) {await response.body?.cancel(); continue;}
    check(response.status === 200, 'uae_audit_health_http');
    let value; try {value = await response.json();} catch {check(false, 'uae_audit_health_json');}
    check(value?.ok === true && value?.releaseSha === PINS.live
      && value?.calculationVersion === PINS.liveCalculator, 'uae_audit_live_identity_changed');
    return {releaseSha:value.releaseSha, calculationVersion:value.calculationVersion};
  }
}
const metaProof = meta => ({found:meta.found, etagSha256:meta.etag ? bytesHash(meta.etag) : null, sha256:hash(meta.value)});

export async function runAudit(root) {
  assertSource(root); process.chdir(root);
  process.env.AVTOCENA_RELEASE_SHA = PINS.candidate; process.env.AVTOCENA_CALCULATION_VERSION = PINS.calculator;
  process.env.JSON_STORAGE_DRIVER = 'object';
  check(process.env.YC_OBJECT_STORAGE_ENDPOINT === endpoint && process.env.YC_OBJECT_STORAGE_BUCKET === bucket
    && String(process.env.YC_OBJECT_STORAGE_PREFIX || '').replace(/^\/+|\/+$/g,'') === storagePrefix.slice(0,-1), 'uae_audit_storage_config');
  const fence = installReadOnlyNetwork(), report = {version:1, auditOnly:true, s3Writes:0, supplierRequests:0,
    candidatePrepared:false, installed:false, published:false, verified:false, pins:PINS, checkedAt:new Date().toISOString(),
    utcDay:new Date().toISOString().slice(0,10), policyDay:day(), issues:[]};
  const runtime = relative => import(pathToFileURL(path.join(root,relative)).href);
  try {
    const {getJsonStorage} = await runtime('apps/web/lib/data.ts'), storage = getJsonStorage(); forbidStorageWrites(storage);
    const tracked = new Map();
    const track = async key => {const meta = await storage.readJsonWithMeta(key,null); tracked.set(key,meta); return meta;};
    report.health = await health();
    const manifestMeta = await track('catalog/manifest.json'), lock = await track('catalog/import-lock.json');
    freeLease(lock);
    check(manifestMeta.found && manifestMeta.etag && manifestMeta.value?.generationId === PINS.generation
      && hash(manifestMeta.value) === PINS.manifest, 'uae_audit_manifest_changed');
    report.manifest = {...metaProof(manifestMeta),generationId:PINS.generation,
      counts:Object.fromEntries(['china','korea','uae','europe','georgia'].map(market => [market,manifestMeta.value.markets[market]?.count]))};
    report.controls = metaProof(await track('catalog/operations/collection-controls-v1.json'));
    const {calculationVersion} = await runtime('scripts/catalog-calculation-version.mjs');
    check(calculationVersion(root) === PINS.calculator, 'uae_audit_calculator_changed');
    const indexKey = `knowledge/encyclopedia/calculation-indexes/${PINS.encyclopedia}.json`;
    for (const release of [PINS.live,PINS.candidate]) {
      const binding = await track(`knowledge/encyclopedia/calculation-releases/${release}.json`);
      check(binding.found && hash(binding.value) === hash({version:1,release,digest:PINS.encyclopedia,key:indexKey}), 'uae_audit_private_binding_changed');
      if (release === PINS.candidate) check(hash(binding.value) === PINS.candidateBinding, 'uae_audit_candidate_binding_changed');
    }
    const privateIndex = await storage.readJson(indexKey,null);
    check(privateIndex?.version === 1 && privateIndex.digest === PINS.encyclopedia
      && privateIndex.manifestDigest === PINS.encyclopediaManifest && hash(privateIndex.models) === PINS.encyclopedia, 'uae_audit_private_index_changed');
    // Identical content verification/local restore to restoreCandidateEncyclopedia.
    // No create-only release binding or derived S3 writer is called.
    const target = path.join(root,'data/knowledge/encyclopedia/calculation-v1.json');
    await fs.mkdir(path.dirname(target),{recursive:true}); await fs.writeFile(target,JSON.stringify(privateIndex));
    const [catalog, publication, encyclopedia, inventory, duplicates, dubicars, editorial] = await Promise.all([
      runtime('apps/web/lib/catalog/storage.ts'),runtime('apps/web/lib/catalog/budget-selector-publication.ts'),
      runtime('apps/web/lib/encyclopedia/calculation-index.ts'),runtime('apps/web/lib/catalog/inventory-admission.ts'),
      runtime('apps/web/lib/catalog/reviewed-source-duplicates.ts'),runtime('apps/web/lib/catalog/dubicars-owner-policy.ts'),
      runtime('apps/web/lib/catalog/editorial.ts')]);
    check(encyclopedia.readCalculationIndex()?.digest === PINS.encyclopedia, 'uae_audit_private_runtime_mismatch');
    const editorialMeta = await track('catalog-editorial/current.json');
    editorial.resetCatalogEditorialCache();
    const editorialValue = await editorial.readCatalogEditorial();
    check(object(editorialValue) && typeof editorialValue.revision === 'string' && object(editorialValue.entries)
      && hash(editorialValue) === hash(editorialMeta.found ? editorialMeta.value : {revision:'0',entries:{}}), 'uae_audit_editorial_changed');
    report.editorial = {...metaProof(editorialMeta), entryCount:Object.keys(editorialValue.entries).length};
    const directory = await track(base+'budget-markets-v3/ready.json');
    const selector = await publication.readCompressedSelector(directory.value,'uae',async name => (await track(base+'budget-markets-v3/'+name+'.json')).value);
    const projection = await track(projectionKey), rootIndex = await track(base+'budget-count-v3.json');
    report.objects = {directory:metaProof(directory),projection:metaProof(projection),rootIndex:metaProof(rootIndex)};
    const coverageInput = {manifest:manifestMeta.value,projection:projection.value,selector,rootIndex:rootIndex.value,
      runtime:{prepareRows:catalog.prepareCatalogProjectionRows,canRender:catalog.projectionCanRenderCard,
        age:inventory.catalogInventoryAgeDecision,excluded:inventory.catalogVehicleExcluded,
        duplicate:duplicates.isReviewedSourceDuplicate,allDubicars:dubicars.isAllDubicarsOffer,unpricedDubicars:dubicars.isUnpricedDubicarsOffer}};
    report.coverage = {...analyzeCoverage(coverageInput), mode:'release_gate_no_editorial_context'};
    report.editorialCoverage = {...await analyzeEditorialCoverage(coverageInput,editorial,editorialValue), mode:'visitor_editorial_context'};
    report.cards = await inspectReferencedCards(report.coverage,async key => (await track(key)).value);
    for (const [key,prior] of tracked) {
      const current = await storage.readJsonWithMeta(key,null);
      check(hash(metaProof(current)) === hash(metaProof(prior)), 'uae_audit_source_object_changed');
      if (key === 'catalog/import-lock.json') freeLease(current);
    }
    await health(); assertSource(root);
    check(day() === report.policyDay && new Date().toISOString().slice(0,10) === report.utcDay, 'uae_audit_policy_day_changed');
    report.verified = true;
  } catch (error) {report.issues.push(failure(error));}
  finally {report.io = {...fence.stats}; fence.restore();}
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let report;
  try {report = await runAudit(path.resolve(process.argv[2] || '.'));}
  catch (error) {report = {version:1,auditOnly:true,verified:false,issues:[failure(error)]};}
  const serialized = JSON.stringify(report,null,2)+'\n';
  check(Buffer.byteLength(serialized) <= LIMITS.reportBytes, 'uae_audit_report_budget');
  const output = process.env.UAE_COVERAGE_REPORT;
  check(path.isAbsolute(output || '') && output.endsWith('/uae-candidate-coverage.json'), 'uae_audit_report_path');
  await fs.mkdir(path.dirname(output),{recursive:true}); await fs.writeFile(output,serialized,{mode:0o600});
  console.log(JSON.stringify({auditOnly:true,verified:report.verified,sourceCoveragePassed:report.coverage?.sourceCoveragePassed,
    missingCount:report.coverage?.missingCount,missingInRootCount:report.coverage?.missingInRootCount,
    cardMappings:report.cards,issues:report.issues,io:report.io}));
  if (!report.verified) process.exitCode=2;
}
