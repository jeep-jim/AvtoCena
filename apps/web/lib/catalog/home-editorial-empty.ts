/** Hiding records cannot add rows to a known empty local market.
 * Missing/invalid counts and contradictory rows still require reconciliation. */
export function homeSnapshotMarketIsEmpty(
 snapshot:{marketCounts?:Record<string,unknown>;items:readonly {market?:unknown}[]},
 market:string,
):boolean {
 return snapshot.marketCounts?.[market]===0 && !snapshot.items.some(item=>item.market===market);
}
