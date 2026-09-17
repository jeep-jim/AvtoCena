/** Source-specific research parser. Evidence is not permission to publish a lot. */
export function parseJptradeDetailEvidence(html: string, expectedUrl: string) {
  const expected = /^https:\/\/jptrade\.ru\/stat\/(\d+)$/.exec(expectedUrl);
  if (!expected) return null;
  const canonical = html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1];
  if (canonical !== expectedUrl) return null;
  // This is the primary lot table, before calculators, related lots and footer.
  const block = html.match(/<div\s+class=["']car_options["']\s*>([\s\S]*?)<!--\s*\/\s*car_options\s*-->/i)?.[1];
  if (!block) return null;
  const text = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
    .replace(/&sup3;?/g, '³').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const fields: Record<string, string[]> = {};
  for (const m of block.matchAll(/<div\s+class=["']item["']\s*>\s*([^<]+)<span\b[^>]*>([\s\S]*?)<\/span>/gi)) {
    const name = text(m[1]).replace(/:$/, '').trim();
    if (name) (fields[name] ||= []).push(text(m[2]));
  }
  const powers = fields['Мощность'] || [];
  const values = (unit: RegExp) => [...new Set(powers.flatMap(raw => {
    const m = unit.exec(raw);
    if (!m) return [];
    const n = Number(m[1].replace(',', '.'));
    return Number.isFinite(n) && n > 0 && n <= 2500 ? [n] : [];
  }))];
  const hp = values(/^(\d+(?:[.,]\d+)?)\s*л\.\s*с\.$/i);
  const kw = values(/^(\d+(?:[.,]\d+)?)\s*кВт$/i);
  const mismatch = hp.length === 1 && kw.length === 1
    && Math.abs(hp[0] - kw[0] * 1.35962) > Math.max(2, kw[0] * 1.35962 * 0.015);
  const powerState = hp.length > 1 || kw.length > 1 || mismatch ? 'conflict'
    : !hp.length && !kw.length ? 'missing'
    : hp.length && kw.length ? 'consistent_pair_unverified' : 'single_unit_unverified';
  return {
    sourceId: expected[1], sourceUrl: expectedUrl, sourceFields: fields,
    power: { state: powerState, rawValues: powers, hpValues: hp, kwValues: kw },
    // Auction cc may be a rounded class (e.g. 2400), even with an explicit unit.
    // No exact engine cc, fuel, certified 30-minute power or calculation is inferred.
    auctionDisplacementRaw: fields['Объем'] || [],
    soldStatusRaw: fields['Статус'] || [], lastBidRaw: fields['Последняя ставка'] || [],
    sourceAccepted: false, publicationReady: false,
  };
}
