// Stop an incomplete source from replacing a healthy public generation.
// Verified withdrawals reduce the baseline; absence or expiry alone does not.
export function catalogPublicCountGuard(previous, next, withdrawn = {}, ratio = 0.9) {
  if (!Number.isFinite(ratio) || ratio < 0.9 || ratio > 1) throw Error('invalid_public_retention_ratio');
  const failures = [];
  let baseline = 0, totalNext = 0;
  for (const [source, count] of Object.entries(previous)) {
    const remaining = Math.max(0, count - Math.min(count, withdrawn[source] || 0));
    baseline += remaining;
    const minimum = Math.ceil(remaining * ratio);
    const actual = next[source] || 0;
    if (actual < minimum) failures.push({source, previous:count, confirmedWithdrawals:withdrawn[source] || 0, minimum, actual});
  }
  for (const count of Object.values(next)) totalNext += count;
  const minimumTotal = Math.max(1, Math.ceil(baseline * ratio));
  return {ok:totalNext >= minimumTotal && failures.length === 0, minimumTotal, totalNext, failures};
}
