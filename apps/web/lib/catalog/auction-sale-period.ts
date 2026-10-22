import {filterSelections} from './filter-selections';
export const AUCTION_SALE_PERIODS=[{value:'week',label:'За неделю'},{value:'month',label:'За месяц'},{value:'2months',label:'За 2 месяца'},{value:'3months',label:'За 3 месяца'}];
/** Inclusive local calendar dates. Selected overlapping periods form a union. */
export function auctionSaleRange(value:string,now=new Date()){
 const selected=filterSelections(value);
 if(!selected.length)return null;
 if(selected.some(v=>!AUCTION_SALE_PERIODS.some(p=>p.value===v)))throw Error('invalid_sale_period');
 const day=new Date(now.getTime()+7*3600000).toISOString().slice(0,10);
 const today=new Date(day+'T00:00:00Z');
 const starts=selected.map(v=>{
  const start=new Date(today);
  if(v==='week')start.setUTCDate(start.getUTCDate()-6);
  else {const months=v==='month'?1:v==='2months'?2:3;const d=start.getUTCDate();start.setUTCDate(1);start.setUTCMonth(start.getUTCMonth()-months);const last=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)).getUTCDate();start.setUTCDate(Math.min(d,last));}
  return start.toISOString().slice(0,10);
 });
 const end=new Date(today);end.setUTCDate(end.getUTCDate()+1);
 return {from:starts.sort()[0],toExclusive:end.toISOString().slice(0,10)};
}
export function auctionSaleDateLabel(value:unknown){
 const day=String(value||'').slice(0,10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day)return '';
 return day.split('-').reverse().join('.');
}
