import { mutateDataJson, readDataJson } from "../data";
import type { CatalogSourceAdapter, CatalogSourcePolicy, SourceRunHealth } from "./types";
const DEFAULTS = { maxRequestsPerMinute: 10, maxPagesPerRun: 5, maxOffersPerRun: 5000, maxDetailsPerRun: 500 };
export async function getSourcePolicy(source: CatalogSourceAdapter): Promise<CatalogSourcePolicy> {
  return readDataJson<CatalogSourcePolicy>(`catalog/sources/${source.sourceId}.json`, { sourceId: source.sourceId, market: source.market, enabled: true, accessMode: source.accessMode, listUrl: "", robotsUrl: source.accessMode === "public_html" ? "https://www.beforward.jp/robots.txt" : undefined, parserVersion: "2026-07-14", ...DEFAULTS, imagesEnabled: true, consecutiveFailures: 0 });
}
export async function mutateSourcePolicy(source: CatalogSourceAdapter, updater: (policy: CatalogSourcePolicy) => CatalogSourcePolicy) { return mutateDataJson<CatalogSourcePolicy>(`catalog/sources/${source.sourceId}.json`, await getSourcePolicy(source), updater); }
export async function updatePolicyAfterRun(source: CatalogSourceAdapter, health: SourceRunHealth, cursor?: string | null) {
  const now = new Date().toISOString();
  await mutateSourcePolicy(source, (policy) => {
    if (health.ok) return { ...policy, lastSuccessAt: now, lastError: undefined, lastSuccessfulCursor: cursor ?? policy.lastSuccessfulCursor, consecutiveFailures: 0, blockedUntil: undefined };
    const failures = policy.consecutiveFailures + 1;
    return { ...policy, lastErrorAt: now, lastError: health.message, consecutiveFailures: failures, blockedUntil: health.blocked || failures >= 3 ? new Date(Date.now() + 60 * 60 * 1000).toISOString() : policy.blockedUntil };
  });
}
export function policyAllowsRun(policy: CatalogSourcePolicy) { return policy.enabled && (!policy.blockedUntil || Date.parse(policy.blockedUntil) < Date.now()); }
