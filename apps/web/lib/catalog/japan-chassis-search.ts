// Search equivalence only. These prefixes are already recognised by the local
// Japan fuel, calculation and reviewed chassis code paths. Do not treat an
// arbitrary short segment as a prefix: SKE-012345 is a full frame identifier.
const prefixes = ['E','GF','TA','ABA','CBA','DBA','DAA','DLA','HBD','EBD','LDA',
  '3BA','4BA','5BA','7BA','3BD','5BD','3DA','5AA','6AA','6LA','ZAA'];
const prefixPattern = prefixes.join('|');
const prefixedCode = new RegExp(`^(?:${prefixPattern})-([A-Z0-9]+)$`);

function chassis(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const raw = String(value).normalize('NFKC').trim().toUpperCase();
  // Keep the established literal input alphabet. Quotes, wildcards, controls
  // and SQL punctuation cannot reach either the literal or regexp below.
  if (!/^[\p{L}\p{N} .+()&/-]{1,80}$/u.test(raw)) return null;
  const base = /^[A-Z0-9]+$/.test(raw) ? raw : prefixedCode.exec(raw)?.[1];
  return {raw, base};
}

/** Match a whole chassis code, with only a recognised optional Japan prefix.
 * Complex or unknown formats retain their original exact-match semantics.
 */
export function japanChassisSearchSql(value: unknown): string | null {
  const code = chassis(value);
  if (!code) return null;
  if (!code.base) return `kuzov='${code.raw}'`;
  return `(kuzov='${code.base}' or kuzov regexp '^(${prefixPattern})-${code.base}$')`;
}

/** Same selection as SQL for bounded saved lots; never changes stored facts. */
export function matchesJapanSearchChassis(value: unknown, selection: unknown): boolean {
  const source = chassis(value), query = chassis(selection);
  return Boolean(source && query && (source.base || source.raw) === (query.base || query.raw));
}
