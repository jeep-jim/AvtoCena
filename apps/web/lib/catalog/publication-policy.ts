/** Owner withdrawal, 13 October 2026. Independent of collection switches.
 * Historical records remain in storage; they must never be republished.
 * Green Corner uses its own stock identity and remains available.
 */
type Identity = {id?: unknown; market?: unknown; sourceId?: unknown; sourceGroup?: unknown; marketLabel?: unknown; imageUrl?: unknown};
export function retiredSourceUrl(value: unknown): boolean {
  if(typeof value !== "string" || !value) return false;
  try { return /(^|\.)(pro-auctions\.ru|pa-server\.ru|jptrade\.ru)$/i.test(new URL(String(value)).hostname); }
  catch { return false; }
}
export function publicationWithdrawn(offer: Identity): boolean {
  const source = String(offer.sourceId || offer.sourceGroup || '').toLowerCase();
  if (/proauctions|jptrade/.test(source) || retiredSourceUrl(offer.imageUrl)) return true;
  const id = String(offer.id || '');
  const japan = String(offer.market || '').toLowerCase() === 'japan'
    || /япони/i.test(String(offer.marketLabel || ''))
    || /^(?:proauctions|jptrade|japan|sferacar|auctiondatasearch|jpcenter)[_-]/i.test(id);
  const paidJapan = /^ajes-stats-[A-Za-z0-9_-]{1,64}$/.test(id) && (!source || source === 'ajes_japan_feed');
  return japan && !/^green-\d+$/.test(id) && !paidJapan;
}
export function withoutJapanAuctionCounts<T extends {count:number;marketCounts:Record<string,number>}>(row:T):T {
  const {japan = 0, ...marketCounts} = row.marketCounts;
  return {...row, count: Math.max(0, row.count - japan), marketCounts};
}
