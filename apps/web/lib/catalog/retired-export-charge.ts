import { activeMarketCosts } from '../../../../packages/engine/src/calculation/market-cost-policy';
import { businessPaymentPlan } from '../../../../packages/engine/src/calculation/calculateAvtocena';

/** Remove only an attested historical charge, once, without touching source price/customs. */
export function withoutRetiredExportCharge<T extends Record<string, any>>(offer:T):T {
  const snapshot = offer.calculationSnapshot;
  const lines = snapshot?.breakdown;
  if (!Array.isArray(lines)) return offer;
  const retired = lines.filter(line => line.id === 'export');
  if (!retired.length) return offer;
  const amount = retired.reduce((sum,line)=>sum+Number(line.amountRub),0);
  if (!Number.isFinite(amount) || amount < 0) return offer;
  let delta = amount;
  const config = activeMarketCosts(snapshot.marketConfig || {});
  const breakdown = lines.filter(line=>line.id !== 'export').map(line=>{
    const expense = config.percentExpenses?.find((item:any)=>item.id===line.id);
    if (!expense || line.amountType !== 'percent') return line;
    const base = lines.filter(item=>item.amountType !== 'percent').reduce((sum,item)=>sum+Number(item.amountRub),0);
    const oldAmount = Math.round(base*Number(expense.percent)/100);
    if (!Number.isFinite(oldAmount) || oldAmount !== Number(line.amountRub)) return line;
    const next = Math.round((base-amount)*Number(expense.percent)/100);
    delta += oldAmount-next;
    return {...line,amountRub:next};
  });
  const totalRub = Number(offer.totalRub)>0 ? Number(offer.totalRub)-delta : offer.totalRub;
  if (typeof totalRub==='number' && totalRub<0) return offer;
  const paymentPlan = Number(totalRub)>0 ? businessPaymentPlan(offer.market,config,totalRub) : snapshot.paymentPlan;
  return {...offer,totalRub,previousTotalRub:null,priceDeltaRub:null,priceChangedAt:undefined,
    ...(Number(offer.publicVisibleRub)>0 ? {publicVisibleRub:Number(offer.publicVisibleRub)-delta} : {}),
    calculationSnapshot:{...snapshot,marketConfig:config,breakdown,paymentPlan}} as T;
}
