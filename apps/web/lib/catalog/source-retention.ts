import type { VehicleOffer } from "./types";

export type CatalogSourceRefreshState = {
  sourceId: string;
  observed: boolean;
  authoritative: boolean;
  liveReports: number;
  pages: number;
  freshSaved: number;
  restoredSaved: number;
  stopReasons: string[];
};

type GenerationPayload = {
  report?: {
    sources?: Array<Record<string, unknown>>;
  };
};

function positiveInt(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function sourceReportRows(payloads: GenerationPayload[]) {
  return payloads.flatMap((payload) => Array.isArray(payload?.report?.sources) ? payload.report!.sources! : []);
}

/**
 * A source is authoritative for expiry only when a real live crawl completed a
 * source cycle and produced fresh rows. A timeout, parser error, retention-only
 * shard or zero-fresh run must never be interpreted as proof that old listings
 * disappeared from the source.
 */
export function catalogSourceRefreshStates(payloads: GenerationPayload[]) {
  const grouped = new Map<string, CatalogSourceRefreshState>();
  for (const row of sourceReportRows(payloads)) {
    const sourceId = String(row.sourceId || "").trim();
    if (!sourceId) continue;
    const current = grouped.get(sourceId) || {
      sourceId,
      observed: false,
      authoritative: false,
      liveReports: 0,
      pages: 0,
      freshSaved: 0,
      restoredSaved: 0,
      stopReasons: [],
    };
    const mode = String(row.mode || "").toLowerCase();
    const stopReason = String(row.stopReason || "").toLowerCase();
    const pages = positiveInt(row.pages);
    const freshSaved = positiveInt(row.freshSaved);
    const restoredSaved = positiveInt(row.restoredSaved);
    current.observed = true;
    current.pages += pages;
    current.freshSaved += freshSaved;
    current.restoredSaved += restoredSaved;
    if (mode === "live") current.liveReports += 1;
    if (stopReason && !current.stopReasons.includes(stopReason)) current.stopReasons.push(stopReason);
    if (mode === "live" && pages > 0 && freshSaved > 0 && stopReason === "source_cycle_finished") {
      current.authoritative = true;
    }
    grouped.set(sourceId, current);
  }
  return Object.fromEntries([...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

export function catalogOfferFreshness(offer: Partial<VehicleOffer>) {
  return Date.parse(String(
    offer.updatedAt
      || offer.operational?.fullRebuildAt
      || offer.operational?.sourcePublishedAt
      || offer.firstSeenAt
      || "",
  )) || 0;
}

export function catalogRetentionDecision(args: {
  offer: Partial<VehicleOffer>;
  now?: number;
  retentionMs: number;
  outageGraceMultiplier?: number;
  sourceStates: Record<string, CatalogSourceRefreshState>;
}) {
  const now = Number(args.now || Date.now());
  const retentionMs = Math.max(60_000, Number(args.retentionMs || 0));
  const multiplier = Math.max(1, Math.min(4, Number(args.outageGraceMultiplier || 2)));
  const freshness = catalogOfferFreshness(args.offer);
  const ageMs = freshness > 0 ? Math.max(0, now - freshness) : Number.MAX_SAFE_INTEGER;
  const sourceId = String(args.offer.sourceId || "");
  const sourceState = args.sourceStates[sourceId];
  if (ageMs <= retentionMs) return { retain: true, reason: "within_retention", ageMs, sourceId, sourceState };
  if (sourceState?.authoritative) return { retain: false, reason: "expired_after_authoritative_refresh", ageMs, sourceId, sourceState };
  const outageGraceMs = retentionMs * multiplier;
  if (ageMs <= outageGraceMs) return { retain: true, reason: "source_outage_grace", ageMs, sourceId, sourceState };
  return { retain: false, reason: "outage_grace_expired", ageMs, sourceId, sourceState };
}
