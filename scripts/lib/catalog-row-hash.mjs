import crypto from 'node:crypto';

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableJsonValue(value[key])]));
  }
  return value;
}

// Preserve the canonical JSON-array digest without allocating a market-sized
// string (Europe's specification tables exceed V8's single-string limit).
export function hashRows(rows) {
  const hash = crypto.createHash('sha256').update('[');
  const ordered = [...rows].sort((a, b) => String(a?.id || '').localeCompare(String(b?.id || '')));
  for (let index = 0; index < ordered.length; index++) {
    if (index) hash.update(',');
    hash.update(JSON.stringify(stableJsonValue(ordered[index])) ?? 'null');
  }
  return hash.update(']').digest('hex');
}
