import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {rawDigest} from './catalog-raw-provenance.mjs';
import {createSourceContributionProtocol} from './catalog-source-contributions.mjs';

export const PAID_CONTRIBUTION_KIND = 'independent_paid_encar_snapshot_v1';
const SHA = /^[a-f0-9]{64}$/, REVISION = /^[a-f0-9]{40}$/;
const MAX_ROWS = 500000, MAX_PAGES = 100000;
const byteDigest = value => createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const sortedPairs = values => [...values].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
const rowId = row => typeof row?.id === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(row.id) ? row.id : null;
const paidRow = row => rowId(row) && row.market === 'korea' && row.sourceId === 'encar_direct'
  && row.operational?.provider === 'auto_api_encar';
const signed = value => ({...value, checksum: rawDigest(value)});

/** Workflow owner and checked-out normalization source are separate identities.
 * A dirty/untracked code closure is ineligible for retirement evidence. */
export function paidContributionWorkerSource(root = fileURLToPath(new URL('../../', import.meta.url))) {
  const options = {cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']};
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', 'scripts/lib/catalog-paid-encar-contributions.mjs',
      'scripts/lib/catalog-source-contributions.mjs', 'scripts/lib/catalog-source-contribution-authority.mjs',
      'scripts/lib/paid-encar-offer.mjs', 'scripts/catalog-restore-encar-snapshot.mjs',
      'scripts/catalog-publish-market.mjs', 'apps/web/lib/catalog/adapters.ts'], options);
    execFileSync('git', ['diff', '--quiet', 'HEAD', '--'], options);
    const sourceSha = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], options).trim();
    return REVISION.test(sourceSha) ? sourceSha : null;
  } catch {return null;}
}
function checkSigned(value, code) {
  assert.ok(value && SHA.test(value.checksum || ''), code);
  const {checksum, ...body} = value;
  assert.equal(rawDigest(body), checksum, code);
  return value;
}

/** Hash the complete deduplicated source payloads, not just their identities. */
export function paidInputRowsProof(rows) {
  const values = new Map();
  for (const row of rows) {
    assert.ok(paidRow(row) && !values.has(row.id) && values.size < MAX_ROWS, 'paid_contribution_input_rows');
    values.set(row.id, rawDigest(row));
  }
  const pairs = sortedPairs(values);
  return {rows: pairs.length, idsSha256: rawDigest(pairs.map(([id]) => id)), rowsSha256: rawDigest(pairs)};
}

export function assertPaidInputWitness(value) {
  checkSigned(value, 'paid_contribution_input_checksum');
  assert.ok(value.version === 1 && value.kind === PAID_CONTRIBUTION_KIND && value.sourceId === 'encar_direct',
    'paid_contribution_input_kind');
  const producer = value.producer, source = value.snapshot, normalized = value.normalized;
  assert.ok(/^\d{1,20}$/.test(producer?.runId || '') && /^[1-9]\d{0,5}$/.test(producer?.attempt || '')
    && REVISION.test(producer?.sourceSha || ''), 'paid_contribution_input_producer');
  assert.ok(/^catalog\/intake-staging\/encar\/\d{1,20}\/[1-9]\d{0,5}$/.test(source?.root || '')
    && SHA.test(source.completeSha256 || '') && SHA.test(source.pagesSha256 || '')
    && Number.isSafeInteger(source.pages) && source.pages > 0 && source.pages <= MAX_PAGES
    && Number.isSafeInteger(source.rows) && source.rows > 0 && source.rows <= 1000000
    && typeof source.completedAt === 'string' && Number.isFinite(Date.parse(source.completedAt)), 'paid_contribution_input_snapshot');
  assert.ok(Number.isSafeInteger(normalized?.rows) && normalized.rows > 0 && normalized.rows <= MAX_ROWS
    && normalized.rows <= source.rows && SHA.test(normalized.idsSha256 || '') && SHA.test(normalized.rowsSha256 || ''),
    'paid_contribution_input_normalized');
  return value;
}

/** The only input reader exposed to the restorer is a sequential saved page
 * GET. Current/public/internal catalog rows cannot enter this witness. Bounds
 * limit proof eligibility; they never reduce the existing intake inventory. */
export function createIndependentPaidInput({storage, run, attempt, snapshot, owner, sourceSha = owner?.revision}) {
  const root = `catalog/intake-staging/encar/${run}/${attempt}`;
  const source = clone(snapshot), completeSha256 = rawDigest(source), input = new Map();
  let nextPage = 1, rawRows = 0, observations = 0, currentRows = new WeakSet(), finished = false;
  let eligible = /^catalog\/intake-staging\/encar\/\d{1,20}\/[1-9]\d{0,5}$/.test(root)
    && Number.isSafeInteger(source?.pages) && source.pages > 0 && source.pages <= MAX_PAGES
    && Number.isSafeInteger(source?.count) && source.count > 0 && source.count <= 1000000;
  const pages = createHash('sha256').update('[');
  return {
    async readPage(page) {
      assert.ok(!finished && page === nextPage && page <= source.pages, 'paid_contribution_page_order');
      const rows = await storage.readJson(`${root}/pages/${page}.json`, null);
      if (Array.isArray(rows)) {
        if (page > 1) pages.update(',');
        pages.update(JSON.stringify([page, rawDigest(rows), rows.length]));
        rawRows += rows.length;
        currentRows = new WeakSet(rows.filter(row => row && typeof row === 'object'));
      } else eligible = false;
      nextPage++;
      return rows;
    },
    recordOffer(raw, offer) {
      observations++;
      if (!eligible) return;
      if (!currentRows.has(raw) || !paidRow(offer) || String(raw?.inner_id) !== String(raw?.data?.inner_id)
          || String(offer.sourceOfferId) !== String(raw.inner_id) || input.size >= MAX_ROWS && !input.has(offer.id)) {
        eligible = false; input.clear(); return;
      }
      currentRows.delete(raw);
      // SQLite conversion deliberately keeps the last payload for an ID.
      input.set(offer.id, rawDigest(offer));
    },
    async finish({observations: expectedObservations, excluded}) {
      assert.equal(finished, false, 'paid_contribution_input_finished'); finished = true;
      if (!eligible || !input.size || nextPage !== source.pages + 1 || rawRows !== source.count
          || observations !== expectedObservations || observations + excluded !== rawRows) return null;
      if (rawDigest(await storage.readJson(root + '/complete.json', null)) !== completeSha256) return null;
      const pairs = sortedPairs(input), value = signed({version: 1, kind: PAID_CONTRIBUTION_KIND, sourceId: 'encar_direct',
        producer: {runId: String(owner?.runId || ''), attempt: String(owner?.attempt || ''), sourceSha},
        snapshot: {root, completeSha256, pages: source.pages, pagesSha256: pages.update(']').digest('hex'),
          rows: rawRows, completedAt: source.completedAt},
        normalized: {rows: pairs.length, idsSha256: rawDigest(pairs.map(([id]) => id)), rowsSha256: rawDigest(pairs)}});
      try {return assertPaidInputWitness(value);} catch {return null;}
    },
  };
}

/** A changed/deduplicated output invalidates the optional proof, not the feed. */
export function verifiedPaidInputReport(report, rows) {
  if (!report?.paidInputWitness) return report;
  try {
    const witness = assertPaidInputWitness(report.paidInputWitness);
    assert.equal(rawDigest(paidInputRowsProof(rows)), rawDigest(witness.normalized), 'paid_contribution_converted_rows');
    return report;
  } catch {
    const {paidInputWitness, ...rest} = report;
    return rest;
  }
}

function cleanPaidIntake(intake, freshOffers, sellerInventory) {
  const source = intake?.sources?.[0], witness = assertPaidInputWitness(intake?.paidInputWitness);
  assert.ok(sellerInventory && intake.market === 'korea' && intake.provider === 'auto_api_encar' && intake.completed === true
    && !intake.technicalRepair && intake.mode !== 'saved_snapshot_technical_repair' && !intake.failure
    && intake.sources?.length === 1 && source.sourceId === 'encar_direct' && source.provider === 'auto_api_encar'
    && source.syncMode === 'snapshot' && source.stopReason === 'source_finished'
    && !source.partial && !source.failure && !(intake.rawArchiveDependencies?.length)
    && !(intake.confirmedWithdrawals?.length) && intake.durableIntakeArchive
    && source.uniqueOffers === witness.normalized.rows && intake.completedAt === witness.snapshot.completedAt
    && witness.snapshot.root === `catalog/intake-staging/encar/${intake.snapshotRun}/${intake.snapshotAttempt}`,
  'paid_contribution_not_independent_snapshot');
  assert.equal(rawDigest(paidInputRowsProof(freshOffers)), rawDigest(witness.normalized), 'paid_contribution_fresh_bytes');
  return witness;
}

const protocol=createSourceContributionProtocol({sourceId:'encar_direct',market:'korea',producerKind:PAID_CONTRIBUTION_KIND,
  witnessField:'paidInputWitness',snapshotKind:'encar-snapshot',snapshotReceiptLeaf:'complete.json',
  sourceRow:paidRow,assertWitness:assertPaidInputWitness,validateInput:cleanPaidIntake,
  defaultReusableSourceIds:['encar_direct','kcar_korea_open'],errorPrefix:'paid_contribution'});
export const createPaidPublicationContributions=protocol.createPublicationContributions;
export const paidContributionKey=protocol.contributionKey;
export const readPaidInputArchive=protocol.readInputArchive;
export const preparePaidPublicContribution=protocol.preparePublicContribution;
export const preparePaidInternalContribution=({reusableKoreaSourceIds,...options})=>protocol.prepareInternalContribution({
  ...options,...(reusableKoreaSourceIds?{reusableSourceIds:reusableKoreaSourceIds}:{})});
export const verifyPaidPublicContribution=protocol.verifyPublicContribution;
export const verifyPaidInternalContribution=protocol.verifyInternalContribution;
export const assertPaidPublicContribution=async options=>(await verifyPaidPublicContribution({...options,market:'korea'})).reference;
