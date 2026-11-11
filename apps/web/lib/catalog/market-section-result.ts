/** An unavailable market is NOT an empty market. Never cache this result as inventory. */
export type MarketSectionResult<T> = T & {unavailable?: boolean};
export async function readMarketSection<T extends object>(read:()=>Promise<T>, fallback:T, onFailure:(error:unknown)=>void):Promise<MarketSectionResult<T>> {
 try {return await read();}
 catch(error) {
  if(error && typeof error==='object' && 'digest' in error && String(error.digest).startsWith('NEXT_')) throw error;
  onFailure(error);
  return {...fallback,unavailable:true};
 }
}
