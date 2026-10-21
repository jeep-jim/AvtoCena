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
/** Retained compatibility export; source restoration is disabled by owner policy. */
export {applyUaeManualSpecifications as restoreDubicarsDisplacement} from './uae-manual-specifications';
