/** Empty alias files are written for every market, including externally owned Japan.
 * Presence in those aliases is not presence in the immutable source manifest. */
export function retainedRepairMarketCounts(manifest, actual) {
 const counts={};
 for(const [market,source] of Object.entries(manifest.markets||{})){
  const expected=Number(source.count);
  if(!Number.isSafeInteger(expected)||expected<=0||actual[market]!==expected)
   throw Error(`catalog_repair_retained_count_mismatch:${market}`);
  counts[market]=actual[market];
 }
 for(const [market,count] of Object.entries(actual)){
  if(!Object.prototype.hasOwnProperty.call(counts,market)&&count!==0)
   throw Error(`catalog_repair_unexpected_local_market:${market}`);
 }
 return counts;
}
