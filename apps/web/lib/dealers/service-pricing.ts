import {DEALER_MARKETS,type DealerMarket} from './catalog-markets';
export const DEALER_SERVICES=[{id:'commission',label:'Комиссия компании'},{id:'delivery',label:'Доставка'},{id:'documents',label:'Оформление документов'}] as const;
export type DealerService=typeof DEALER_SERVICES[number]['id'];
export type DealerServicePricing=Partial<Record<DealerMarket,Partial<Record<DealerService,{enabled:boolean;priceRub:number}>>>>;
// Tenant-owned service quotations only. Never accepted as platform market config.
export function normalizeDealerServicePricing(value:unknown):DealerServicePricing {
 const input=value&&typeof value==='object'?value as Record<string,any>:{};
 const result:DealerServicePricing={};
 for(const market of DEALER_MARKETS){
  if(!input[market.id]||typeof input[market.id]!=='object')continue;
  const row:Partial<Record<DealerService,{enabled:boolean;priceRub:number}>>={};
  for(const service of DEALER_SERVICES){const raw=input[market.id][service.id];if(!raw||typeof raw!=='object')continue;const price=Number(raw.priceRub);if(!Number.isFinite(price)||price<0||price>10000000)throw Error(`Проверьте стоимость услуги «${service.label}»: ${market.label}`);row[service.id]={enabled:raw.enabled===true,priceRub:Math.round(price)};}
  result[market.id]=row;
 }
 return result;
}
