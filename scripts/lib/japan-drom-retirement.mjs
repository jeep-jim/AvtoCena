import { createHash } from 'node:crypto';
export const retiredJapanSource = 'drom_japan_stat';
export function hashRetirementRows(rows) {
  const hash = createHash('sha256').update('[');
  let separator = '';
  for (const row of [...rows].sort((a,b)=>a.id.localeCompare(b.id))) {
    hash.update(separator).update(JSON.stringify(row));
    separator = ',';
  }
  return hash.update(']').digest('hex');
}
export function planJapanDromRetirement(rows) {
  if(rows.some(r=>r.market!=='japan'))throw Error('retirement_requires_japan_only');
  const removed=rows.filter(r=>r.sourceId===retiredJapanSource);
  const kept=rows.filter(r=>r.sourceId!==retiredJapanSource);
  if(!kept.length || !kept.some(r=>r.sourceId==='proauctions_japan_stat'))throw Error('verified_replacement_required');
  const removals=new Map(removed.map(r=>[r.id,'audit:owner_retired_drom_20260918']));
  return {removed,kept,removals};
}
export function assertExactRetirementPreservation(expected, actual) {
  if(actual.some(r=>r.sourceId===retiredJapanSource))throw Error('retired_drom_survived');
  if(actual.length!==expected.length || hashRetirementRows(actual)!==hashRetirementRows(expected))throw Error('retirement_changed_surviving_records');
}
