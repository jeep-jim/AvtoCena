/** Add the configured cost to older derived search prices without touching source evidence. */
export function includedDepositCost(snapshot:any):number {
 if(Array.isArray(snapshot?.breakdown))return snapshot.breakdown.filter((l:any)=>l.id==='contract-services').reduce((s:number,l:any)=>s+Number(l.amountRub||0),0);
 return Number(snapshot?.depositCostRub ?? snapshot?.serviceCostBasis?.securityDepositCostRub ?? 0);
}
export function applyDepositToProjection<T extends {market?:string;totalRub?:number|null;catalogPricingMode?:string;calculationSnapshot?:any;publicVisibleRub?:number|null}>(row:T,deposit:number):T {
 if(row.catalogPricingMode==='seller'||!(Number(row.totalRub)>0))return row;
 const snapshot=row.calculationSnapshot || {};
 const delta=deposit-includedDepositCost(snapshot);
 if(!delta)return row;
 const breakdown=Array.isArray(snapshot.breakdown)?[...snapshot.breakdown.filter((l:any)=>l.id!=='contract-services'),...(deposit?[{id:'contract-services',title:'Обеспечительный платёж',amountRub:deposit,kind:'deposit',amountType:'fixed',source:'market_config'}]:[])]:undefined;
 return {...row,totalRub:Number(row.totalRub)+delta,...(Number(row.publicVisibleRub)>0?{publicVisibleRub:Number(row.publicVisibleRub)+delta}:{}),
  calculationSnapshot:{...snapshot,depositCostRub:deposit,...(breakdown?{breakdown}:{}),...(snapshot.serviceCostBasis?{serviceCostBasis:{...snapshot.serviceCostBasis,securityDepositCostRub:deposit}}:{})}};
}
export async function currentDepositCosts():Promise<Record<string,number>> {
 const {getEffectiveDepositCosts}=await import('../effective-market-settings');
 return getEffectiveDepositCosts();
}
export async function withCurrentDepositCosts<T extends Parameters<typeof applyDepositToProjection>[0]>(rows:T[]):Promise<T[]> {
 const costs=await currentDepositCosts();
 return rows.map(row=>applyDepositToProjection(row,costs[row.market||'']||0));
}
