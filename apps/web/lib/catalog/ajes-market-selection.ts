import 'server-only';
/** Supplier selection is independent of missing Auto API data or old source URLs. */
export async function usesAjesMarket(market:unknown,_source?:unknown){
 return market==='japan';
}
