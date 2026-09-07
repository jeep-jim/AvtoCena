import assert from "node:assert/strict";
import test from "node:test";
import { catalogRetentionDecision, catalogSourceRefreshStates, catalogConfirmedWithdrawalIndex, catalogOfferWithdrawnByReport } from "../apps/web/lib/catalog/source-retention";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 7, 21, 16, 0, 0);

function offer(sourceId: string, ageDays: number) {
  return {
    id: `${sourceId}:1`,
    sourceId,
    market: "korea" as const,
    updatedAt: new Date(now - ageDays * DAY).toISOString(),
  };
}

test("a healthy completed live source may expire rows beyond normal retention", () => {
  const states = catalogSourceRefreshStates([{
    report: { sources: [{ sourceId: "encar_direct", mode: "live", pages: 120, freshSaved: 4200, restoredSaved: 100, stopReason: "source_cycle_finished" }] },
  }]);
  const result = catalogRetentionDecision({ offer: offer("encar_direct", 15), now, retentionMs: 14 * DAY, sourceStates: states });
  assert.equal(states.encar_direct.authoritative, true);
  assert.equal(result.retain, false);
  assert.equal(result.reason, "expired_after_authoritative_refresh");
});

test("source error cannot extend the owner retention or prove a sale", () => {
  const states = catalogSourceRefreshStates([{
    report: { sources: [{ sourceId: "encar_direct", mode: "live", pages: 2, freshSaved: 0, restoredSaved: 1200, stopReason: "source_errors" }] },
  }]);
  const result = catalogRetentionDecision({ offer: offer("encar_direct", 15), now, retentionMs: 14 * DAY, sourceStates: states });
  assert.equal(states.encar_direct.authoritative, false);
  assert.equal(result.retain, false);
  assert.equal(result.reason, "unverified_retention_expired");
});

test("zero-fresh cycle is not proof that all listings disappeared", () => {
  const states = catalogSourceRefreshStates([{
    report: { sources: [{ sourceId: "encar_direct", mode: "live", pages: 100, freshSaved: 0, restoredSaved: 2000, stopReason: "source_cycle_finished" }] },
  }]);
  assert.equal(states.encar_direct.authoritative, false);
});

test("non-Japan rows expire at fourteen days even without a fresh source report", () => {
  const result = catalogRetentionDecision({ offer: offer("encar_direct", 15), now, retentionMs: 14 * DAY, sourceStates: {} });
  assert.equal(result.retain, false);
  assert.equal(result.reason, "unverified_retention_expired");
});

test("Japan thirty-day retention is not silently doubled", () => {
  const japanOffer = { ...offer("jpcenter_japan_catalog_open", 45), market: "japan" as const };
  const result = catalogRetentionDecision({ offer: japanOffer, now, retentionMs: 30 * DAY, sourceStates: {} });
  assert.equal(result.retain, false);
  assert.equal(result.reason, "unverified_retention_expired");
});
