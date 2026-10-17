const clean = value => String(value ?? '').normalize('NFKC').trim();
const fields = ['seriesId', 'modelYear', 'energy', 'engine', 'engineCc', 'enginePowerHp', 'enginePowerKw', 'transmission', 'drive'];

/** A source spec ID must remain consistent even across canonical model links. */
export function chinaSpecConflicts(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (row.sourceId !== 'autohome-china' || !clean(row.specId)) continue;
    const id = clean(row.specId);
    const group = groups.get(id) || new Map(fields.map(field => [field, new Set()]));
    for (const field of fields) {
      const value = clean(row[field]);
      if (value) group.get(field).add(value);
    }
    groups.set(id, group);
  }
  return [...groups].flatMap(([specId, values]) => {
    const conflicts = Object.fromEntries([...values].filter(([, set]) => set.size > 1)
      .map(([field, set]) => [field, [...set].sort()]));
    return Object.keys(conflicts).length ? [{ specId, conflicts }] : [];
  }).sort((a, b) => a.specId.localeCompare(b.specId));
}
