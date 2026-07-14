import { readDataJson, writeDataJson } from "../data";
import type { CatalogSourceAdapter, CatalogSourcePolicy, SourceRunHealth } from "./types";
const DEFAULTS = { maxRequestsPerMinute: 10, maxPagesPerRun: 5, maxOffersPerRun: 5000, maxDetailsPerRun: 500 };
export async function getSourcePolicy(source: CatalogSourceAdapter): Promise<CatalogSourcePolicy> {
  return readDataJson<CatalogSourcePolicy>(`catalog/sources/${source.sourceId}.json`, { sourceId: source.sourceId, market: source.market, enabled: true, accessMode: source.accessMode, listUrl: "", robotsUrl: source.accessMode === "public_html" ? "https://www.beforward.jp/robots.txt" : undefined, parserVersion: "2026-07-14", ...DEFAULTS, imagesEnabled: true, consecutiveFailures: 0 });
}
export async function savePolicy(policy: CatalogSourcePolicy) { await writeDataJson(`catalog/sources/${policy.sourceId}.json`, policy); }
export async function updatePolicyAfterRun(source: CatalogSourceAdapter, health: SourceRunHealth, cursor?: string | null) {
  const policy = await getSourcePolicy(source); const now = new Date().toISOString();
  if (health.ok) await savePolicy({ ...policy, lastSuccessAt: now, lastError: undefined, lastSuccessfulCursor: cursor ?? policy.lastSuccessfulCursor, consecutiveFailures: 0, blockedUntil: undefined });
  else { const failures = policy.consecutiveFailures + 1; await savePolicy({ ...policy, lastErrorAt: now, lastError: health.message, consecutiveFailures: failures, blockedUntil: health.blocked || failures >= 3 ? new Date(Date.now() + 60 * 60 * 1000).toISOString() : policy.blockedUntil }); }
}
export function policyAllowsRun(policy: CatalogSourcePolicy) { return policy.enabled && (!policy.blockedUntil || Date.parse(policy.blockedUntil) < Date.now()); }
