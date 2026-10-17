/** Preserve explicit displacement fields; never convert marketing litres to cc. */
export function explicitAutohomeDisplacement(map) {
  const rows = [...(map?.values?.() || [])].filter(row =>
    /^排量\s*[（(]\s*(?:mL|cc|cm3|cm³)\s*[）)]$/i.test(String(row.name).trim()));
  const evidence = rows.map(row => ({ parameterId: row.id, name: row.name, rawValue: row.value }));
  const values = rows.map(row => {
    const match = String(row.value).trim().match(/^(\d{3,5})\s*(?:mL|cc|cm3|cm³)?$/i);
    const value = match ? Number(match[1]) : NaN;
    return value >= 300 && value <= 10000 ? value : null;
  });
  const exact = values.length > 0 && values.every(value => value !== null && value === values[0]);
  return { engineCc: exact ? values[0] : null, engineCcEvidence: {
    status: !rows.length ? 'missing' : exact ? 'source_explicit' : 'ambiguous', fields: evidence,
  } };
}
