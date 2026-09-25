// Stop an incomplete source from replacing a healthy public generation.
// Verified withdrawals reduce the baseline; absence or expiry alone does not.
export function catalogPublicCountGuard(previous, next, withdrawn = {}, ratio = 0.9, options = {}) {
  if (!Number.isFinite(ratio) || ratio < 0.9 || ratio > 1) throw Error('invalid_public_retention_ratio');
  const completedSources = new Set(options.completedSources || []);
  const completedSourceCounts = options.completedSourceCounts || {};
  const completedSourceRatio = Number(options.completedSourceRatio ?? 0.8);
  if (!Number.isFinite(completedSourceRatio) || completedSourceRatio < 0.8 || completedSourceRatio > ratio) {
    throw Error('invalid_completed_source_retention_ratio');
  }
  const failures = [];
  let baseline = 0, totalNext = 0;
  for (const [source, count] of Object.entries(previous)) {
    const remaining = Math.max(0, count - Math.min(count, withdrawn[source] || 0));
    baseline += remaining;
    // Autohome is a capped supplement (<=10%), never a guaranteed minimum inventory.
    // Tiny source samples (<20 listings) are monitored separately; losing six
    // rows must not freeze a healthy eight-thousand-car market. The total
    // market and every substantial incomplete source still require at least 90%.
    // A source that was observed through an authoritative source_finished pass
    // may have ordinary inventory turnover between generations. Check its
    // eligible pre-mix pool with a bounded 20% allowance: the global 80/20 power
    // selection may intentionally change source shares. The final published
    // market still has to retain 90%. Partial, blocked and budget-limited passes
    // keep the strict per-source 90% floor on the final public rows.
    const sourceRatio = completedSources.has(source) ? completedSourceRatio : ratio;
    const minimum = source === 'autohome_new_china_open' || Number(count) < 20 ? 0
      : Math.min(Math.ceil(remaining * sourceRatio), Math.max(remaining ? 1 : 0, remaining - 2));
    const publishedActual = next[source] || 0;
    const actual = completedSources.has(source) ? Number(completedSourceCounts[source] ?? publishedActual) : publishedActual;
    if (actual < minimum) failures.push({source, previous:count, confirmedWithdrawals:withdrawn[source] || 0, minimum, actual, publishedActual});
  }
  for (const count of Object.values(next)) totalNext += count;
  const minimumTotal = Math.max(1, Math.ceil(baseline * ratio));
  return {ok:totalNext >= minimumTotal && failures.length === 0, minimumTotal, totalNext, failures,
    completedSources:[...completedSources].filter(source => Object.hasOwn(previous, source)).sort()};
}
