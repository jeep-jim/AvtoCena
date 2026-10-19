/** Supplier confirmed litres on 19.10.2026; retain legacy documented cc values. */
export function dubicarsDisplacement(value: unknown) {
 const raw=typeof value==='number'||typeof value==='string'?String(value).trim():'';
 if(!/^\d+(?:\.\d{1,3})?$/.test(raw))return undefined;
 const n=Number(raw);
 if(!Number.isFinite(n)||n<=0)return undefined;
 const litres=n<100;
 const cc=litres?Math.round(n*1000):n;
 if(cc<100||cc>10000||!Number.isInteger(cc))return undefined;
 return {cc,raw,unit:litres?'L':'cm3',source:litres?'auto_api_dubicars:displacement_litres':'auto_api_dubicars:displacement_cc'};
}
/** Upgrade only missing values from this paid feed; keep exact/manual values. */
export function restoreDubicarsDisplacement<T extends Record<string,any>>(offer:T):T {
 if(offer.market!=='uae'||offer.sourceId!=='dubicars_uae_exact'||offer.operational?.provider!=='auto-api.com'
  ||Number(offer.engineCc)>0||offer.fuel==='electric'||offer.powertrainKind==='electric')return offer;
 const value=dubicarsDisplacement(offer.operational?.sourceDisplacementLabel);
 if(!value)return offer;
 return {...offer,engineCc:value.cc,totalRub:null,calculationStatus:'needs_data',calculationSnapshot:undefined,
  operational:{...offer.operational,semanticEvidence:{...offer.operational?.semanticEvidence,
   engineCc:{source:value.source,status:'exact',value:value.cc,rawValue:value.raw,sourceUnit:value.unit}}}};
}
