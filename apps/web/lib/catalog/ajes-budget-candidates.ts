import type {AjesQuery} from './ajes-query';

/** A necessary source-price bound, never a substitute for the delivered quote.
 * Japan totals retain the whole seller price plus nonnegative costs. Keep one
 * ruble of rounding headroom; do not estimate/subtract customs or assume power.
 * An editorial seller-price override invalidates the source-price implication.
 */
export function ajesBudgetCandidates(query:AjesQuery,budgetTo:number|undefined,rate:any,hasEditorialPrices:boolean):AjesQuery {
 if((query.table||'stats')!=='stats'||query.id||budgetTo===undefined||hasEditorialPrices)return query;
 if(!Number.isSafeInteger(budgetTo)||budgetTo<0)return query;
 const age=Date.now()-Date.parse(rate?.rateDate||'');
 if(rate?.currency!=='JPY'||!['cbr','cbr_live'].includes(rate?.rateSource)
  ||!(rate.effectiveRate>0)||!Number.isFinite(rate.effectiveRate)||!Number.isFinite(age)||age<0||age>4*86400000)return query;
 const ceiling=Math.ceil((budgetTo+1)/rate.effectiveRate);
 if(!Number.isSafeInteger(ceiling)||ceiling<1)return query;
 return {...query,sourcePriceTo:Math.min(query.sourcePriceTo??Number.MAX_SAFE_INTEGER,ceiling)};
}
