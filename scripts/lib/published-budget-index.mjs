import {assertBudgetReadinessReport, stagedBudgetDigest} from './catalog-staged-budget.mjs';

// A successful producer's private receipt only describes the live index when
// the published manifest, calculation inputs and installed selector all match.
export function canReusePublishedBudget({report, manifest, identity, encyclopediaDigest, selectors, rootPresent, now = Date.now()}) {
  if (!report || !manifest || !identity || !rootPresent || selectors?.valid !== true) return false;
  const utcDay = new Date(now).toISOString().slice(0, 10);
  const policyDay = new Date(now + 7 * 3600000).toISOString().slice(0, 10);
  if (report.utcDay !== utcDay || report.policyDay !== policyDay
      || report.generationId !== manifest.generationId || report.manifestDigest !== stagedBudgetDigest(manifest)
      || selectors.generationId !== manifest.generationId) return false;
  try {
    assertBudgetReadinessReport(report, {...identity, manifest, encyclopediaDigest});
  } catch {
    return false;
  }
  return true;
}
