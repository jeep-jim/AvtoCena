import {readDataJson,mutateDataJson} from '../data';
import type {DealerShowcase} from './showcase-model';
export const DEALER_RATE_SOURCE='https://www.profinance.ru/chart/usdrub/';
const key='dealers/rates/usdrub.json';
const INTERVAL=15*60*1000;
export type DealerRate={value:number;quoteAt:string;fetchedAt:string;source:string;timeKind?:'received';sourceTime?:string};
type State={quote:DealerRate|null;attemptAt:string;error:string};
const empty:State={quote:null,attemptAt:'',error:''};
// ProFinance's public HTTP quote widget subscribes to the same USDRUB ticker.
// Its +/- LP prefix is direction, not a negative price (q_show.js strips it).
export function parseDealerRate(text:string,now=Date.now()):DealerRate|null {
 for(const line of text.split('\n')){
  const fields=Object.fromEntries(line.split(';').flatMap(part=>{const i=part.indexOf('=');return i<0?[]:[[part.slice(0,i),part.slice(i+1)]];}));
  if(fields.TICK!=='USDRUB'||fields.S!=='USD/RUB'||!/^\d{2}:\d{2}:\d{2}$/.test(fields.T||''))continue;
  if(!/^[+-]?\d+(?:\.\d+)?$/.test(fields.LP||''))continue;
  const value=Math.abs(Number(fields.LP));if(value<1||value>1000)continue;
  // The widget reports time without date. Store receipt time explicitly; never
  // present it as an exchange tick timestamp or refresh it after a failed read.
  const received=new Date(now).toISOString();
  return {value,quoteAt:received,fetchedAt:received,source:DEALER_RATE_SOURCE,timeKind:'received',sourceTime:fields.T};
 }
 return null;
}
export async function fetchDealerRate():Promise<DealerRate>{
 const signal=AbortSignal.timeout(12000);
 const headers={'User-Agent':'Mozilla/5.0 (compatible; AvtoCena/1.0; +https://avtocena.com)'};
 const session=await fetch('https://jq.profinance.ru/html/htmlquotes/site.jsp',{cache:'no-store',headers,signal});
 if(!session.ok)throw Error('Источник курса временно недоступен');
 const html=await session.text();const sid=html.match(/qtable\.htm\?SID=([a-zA-Z0-9]{1,64})&/)?.[1];
 if(!sid)throw Error('Не удалось открыть котировки ProFinance');
 const response=await fetch('https://jq.profinance.ru/html/htmlquotes/q',{method:'POST',cache:'no-store',headers:{...headers,'Content-Type':'text/plain;charset=UTF-8'},body:`1;SID=${sid};LP=;NCHL=;NCHPL=;SP=;S=USDRUB;\n`,signal});
 if(!response.ok)throw Error('Источник курса временно недоступен');
 const quote=parseDealerRate(await response.text());
 if(!quote)throw Error('ProFinance не передал курс USD/RUB');
 return quote;
}
export async function getDealerRate(){
 let state=await readDataJson<State>(key,empty);
 if(Date.now()-Date.parse(state.attemptAt)<INTERVAL)return state;
 let acquired=false;
 await mutateDataJson<State>(key,empty,current=>{
  acquired=false;
  if(Date.now()-Date.parse(current.attemptAt)<INTERVAL)return current;
  acquired=true;return {...current,attemptAt:new Date().toISOString()};
 });
 if(!acquired)return readDataJson<State>(key,empty);
 try{
  const quote=await fetchDealerRate();
  state=await mutateDataJson<State>(key,empty,current=>({...current,quote,error:''}));
 }catch{
  state=await mutateDataJson<State>(key,empty,current=>({...current,error:'Автообновление временно недоступно. Используется последний сохранённый курс.'}));
 }
 return state;
}
export async function withDealerRate(s:DealerShowcase,refresh=false){
 if(s.pricing.rateMode==='manual'||(refresh&&s.offers.length>0&&s.offers.every(o=>o.availability==='stock')))return s;
 // Public pages read the saved quote immediately. Refresh happens in the editor
 // and scheduled job, so a slow provider cannot delay a visitor's page.
 const {quote}=refresh?await getDealerRate():await readDataJson<State>(key,empty);
 if(!quote)return s;
 return {...s,pricing:{...s.pricing,usdRub:quote.value,rateAt:quote.quoteAt,rateSource:quote.source}};
}
