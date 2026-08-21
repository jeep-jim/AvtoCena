import assert from "node:assert/strict";
import test from "node:test";
import { catalogRetentionDecision, catalogSourceRefreshStates } from "../apps/web/lib/catalog/source-retention";

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
  const result = catalogRetentionDecision({ offer: offer("encar_direct", 4), now, retentionMs: 3 * DAY, sourceStates: states });
  assert.equal(states.encar_direct.authoritative, true);
  assert.equal(result.retain, false);
  assert.equal(result.reason, "expired_after_authoritative_refresh");
});

test("source error protects an otherwise-live row for a bounded outage grace", () => {
  const states = catalogSourceRefreshStates([{
    report: { sources: [{ sourceId: "encar_direct", mode: "live", pages: 2, freshSaved: 0, restoredSaved: 1200, stopReason: "source_errors" }] },
  }]);
  const result = catalogRetentionDecision({ offer: offer("encar_direct", 4), now, retentionMs: 3 * DAY, sourceStates: states });
  assert.equal(states.encar_direct.authoritative, false);
  assert.equal(result.retain, true);
  assert.equal(result.reason, "source_outage_grace");
});

test("zero-fresh cycle is not proof that all listings disappeared", () => {
  const states = catalogSourceRefreshStates([{
    report: { sources: [{ sourceId: "encar_direct", mode: "live", pages: 100, freshSaved: 0, restoredSaved: 2000, stopReason: "source_cycle_finished" }] },
  }]);
  assert.equal(states.encar_direct.authoritative, false);
});

test("outage grace is bounded and eventually expires stale rows", () => {
  const result = catalogRetentionDecision({ offer: offer("encar_direct", 7), now, retentionMs: 3 * DAY, sourceStates: {} });
  assert.equal(result.retain, false);
  assert.equal(result.reason, "outage_grace_expired");
});

test("Japan 30-day retention gets a bounded 60-day outage grace", () => {
  const japanOffer = { ...offer("jpcenter_japan_catalog_open", 45), market: "japan" as const };
  const result = catalogRetentionDecision({ offer: japanOffer, now, retentionMs: 30 * DAY, sourceStates: {} });
  assert.equal(result.retain, true);
  assert.equal(result.reason, "source_outage_grace");
});
