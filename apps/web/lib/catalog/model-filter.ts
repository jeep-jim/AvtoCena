/** Public discovery matches a base model plus any trailing version/trim.
 * Keep token boundaries: A2 must not select A20, nor X5 select X50.
 * This does not change the exact identity used for technical specifications.
 */
export function matchesCatalogModel(value: unknown, query: unknown): boolean {
  const words = (input: unknown) => String(input ?? '').normalize('NFKC')
    .toLocaleLowerCase('ru-RU').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
  const requested = words(query).join('');
  if (!requested) return false;
  let prefix = '';
  for (const word of words(value)) {
    prefix += word;
    if (prefix === requested) return true;
    // Markets also attach letter badges without a separator: A4L, Q2L, X5M.
    if (/\d$/.test(requested) && prefix.startsWith(requested)
      && /^[a-z]+$/.test(prefix.slice(requested.length))) return true;
    if (!requested.startsWith(prefix)) return false;
  }
  return false;
}
