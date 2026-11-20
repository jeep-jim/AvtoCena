// Pure policy. This is NOT wired to cron, a paid collector or CAS. The caller
// verifies immutable baseline/accepted receipts, owner switches and any claim
// against the same authenticated market scope before invoking this module.
const DAY_MS = 86_400_000;
const LOCAL_OFFSET_MS = 7 * 3_600_000;
const scopes = {
  china:   { kind: 'interval', days: 1, utcHour: 14, lane: 'stored_source' },
  korea:   { kind: 'interval', days: 2, utcHour: 17, lane: 'stored_source' },
  uae:     { kind: 'interval', days: 2, utcHour: 17, lane: 'stored_source' },
  georgia: { kind: 'interval', days: 2, utcHour: 17, lane: 'stored_source' },
  green:   { kind: 'interval', days: 3, utcHour: 17, lane: 'stored_source' },
  japan:   { kind: 'local_half_month', utcHour: 17, lane: 'online_only' },
  europe:  { kind: 'delegate_existing' },
};
export const CATALOG_MARKET_SCHEDULE_V1 = Object.freeze(
  Object.fromEntries(Object.entries(scopes).map(([market, policy]) => [market, Object.freeze(policy)])),
);
const SHA = /^[0-9a-f]{64}$/;
const positiveRevision = (x) => Number.isSafeInteger(x) && x >= 1;
const time = (x) => {
  if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x)) return NaN;
  const n = Date.parse(x);
  return Number.isFinite(n) && new Date(n).toISOString() === x ? n : NaN;
};
const isWake = (n, config) => Number.isSafeInteger(n) && n % DAY_MS === config.utcHour * 3_600_000;
const isSlotWake = (n, config, anchor) => {
  if (!isWake(n, config) || n < anchor) return false;
  if (config.kind === 'interval') return (n - anchor) % (config.days * DAY_MS) === 0;
  const date = new Date(n + LOCAL_OFFSET_MS).getUTCDate();
  return date === 1 || date === 16;
};
const hold = (reason) => ({ decision: 'hold', reason, newCollectionAuthorized: false });

function parseEvidence(value, market, config) {
  if (value?.market !== market || !positiveRevision(value?.revision)
    || typeof value.receiptSha256 !== 'string' || !SHA.test(value.receiptSha256)) return null;
  const accepted = time(value.acceptedAt);
  const wake = time(value.coveredWakeAt);
  if (!Number.isFinite(accepted) || !isWake(wake, config) || accepted < wake) return null;
  return { accepted, wake, revision: value.revision, receiptSha256: value.receiptSha256 };
}

/**
 * On approved initial enrollment, baseline pins the exact accepted receipt and
 * its canonical covered wake (an explicit association, never inferred from
 * the collector starting or GitHub going green). Keep that phase stable
 * across later accepted revisions. Europe's existing actor remains untouched.
 * Passing this election returns an idempotency key, not permission to collect.
 */
export function assessMarketScheduleAdmission(input) {
  const market = input?.market;
  if (typeof market !== 'string' || !Object.hasOwn(CATALOG_MARKET_SCHEDULE_V1, market)) return hold('unknown_market');
  const config = CATALOG_MARKET_SCHEDULE_V1[market];
  if (config.kind === 'delegate_existing') return { decision: 'delegate', reason: 'existing_europe_policy', newCollectionAuthorized: false };
  if (input.held !== false || input.ownerEnabled !== true) return hold('not_armed_or_owner_off');
  const now = time(input.now);
  const wake = time(input.scheduledWakeAt);
  if (!isWake(wake, config) || !Number.isFinite(now) || now < wake || now - wake >= DAY_MS) return hold('wake_invalid_or_expired');
  const baseline = parseEvidence(input.baseline, market, config);
  const accepted = parseEvidence(input.accepted, market, config);
  if (!baseline || !accepted || baseline.accepted > now || accepted.accepted > now
    || !isSlotWake(baseline.wake, config, baseline.wake)
    || !isSlotWake(accepted.wake, config, baseline.wake)
    || accepted.revision < baseline.revision || accepted.accepted < baseline.accepted
    || (accepted.revision === baseline.revision
      ? accepted.receiptSha256 !== baseline.receiptSha256 || accepted.accepted !== baseline.accepted || accepted.wake !== baseline.wake
      : accepted.receiptSha256 === baseline.receiptSha256)) return hold('accepted_evidence_invalid');
  if (!isSlotWake(wake, config, baseline.wake)) return hold('outside_cadence_slot');
  if (accepted.wake >= wake) return hold('slot_already_accepted');

  // Identical market + policy baseline + canonical wake gives identical key
  // across retries, UTC day changes, and later accepted market carry-forward.
  const slotKey = `${market}/schedule-v1/${baseline.receiptSha256}/${new Date(wake).toISOString()}`;
  const claim = input.claim;
  if (claim === undefined) return hold('claim_status_not_verified');
  if (claim !== null) {
    const claimedWake = time(claim.coveredWakeAt);
    if (claim.market !== market || claim.baselineReceiptSha256 !== baseline.receiptSha256
      || !isSlotWake(claimedWake, config, baseline.wake) || claimedWake > wake
      || !['open', 'closed'].includes(claim.state)
      || !positiveRevision(claim.expectedAcceptedRevision)
      || claim.expectedAcceptedRevision < baseline.revision || claim.expectedAcceptedRevision > accepted.revision
      || typeof claim.expectedAcceptedSha256 !== 'string' || !SHA.test(claim.expectedAcceptedSha256)
      || (claim.expectedAcceptedRevision === accepted.revision
        ? claim.expectedAcceptedSha256 !== accepted.receiptSha256
        : claim.expectedAcceptedSha256 === accepted.receiptSha256)) return hold('claim_invalid');
    if (claim.state === 'open') return hold('existing_claim_reconcile_only');
    if (claimedWake === wake) return hold('slot_already_claimed');
  }
  return { decision: config.lane === 'online_only' ? 'eligible_online_only_claim' : 'eligible_stored_source_claim',
    slotKey, expectedActive: { revision: accepted.revision, receiptSha256: accepted.receiptSha256 },
    newCollectionAuthorized: false, allowsLocalFullDownload: false };
}
