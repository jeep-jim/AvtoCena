const PRICED_MARKETS=new Set(['china','korea','europe','uae','georgia']);

/** A warmup row is emitted only after both required snapshot writes/readbacks.
 * Missing or unsupported indexes must not become successful release preparation.
 */
export function assertPreparedMarketPrices(result,market,generationId){
 if(!PRICED_MARKETS.has(market)||typeof generationId!=='string'||!generationId)throw Error('price_preparation_context_invalid');
 if(result?.generationId!==generationId)throw Error('price_preparation_generation_changed:'+market);
 if(!Array.isArray(result.results)||result.results.length!==1||result.results[0]?.market!==market)throw Error('price_preparation_market_not_ready:'+market);
 const row=result.results[0];
 if(!Number.isSafeInteger(row.rows)||row.rows<0||!Number.isFinite(row.ms)||row.ms<0)throw Error('price_preparation_result_invalid:'+market);
 return result;
}
