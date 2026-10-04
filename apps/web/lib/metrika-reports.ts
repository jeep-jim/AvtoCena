import {readDataJson} from './data';
import {decryptMetrikaToken,METRIKA_COUNTER_ID} from './metrika-crm';
export type AnalyticsRows={rows:{label:string;detail?:string;path?:string;count:number}[];sampled:boolean;totalRows:number};
export type AnalyticsReport={status:'ready'|'unconfigured'|'error';days:number;updatedAt:string;totals?:{visits:number;users:number;views:number};pages?:AnalyticsRows;cities?:AnalyticsRows;sources?:AnalyticsRows;cars?:AnalyticsRows;message?:string};
const caches=new Map<number,{until:number;value:AnalyticsReport}>();
export async function siteAnalytics(days:number,send:typeof fetch=fetch):Promise<AnalyticsReport>{
 days=[1,7,30].includes(days)?days:7;
 const config=await readDataJson<{enabled:boolean;encryptedToken:string}|null>('integrations/metrika/config.json',null);
 const base={days,updatedAt:new Date().toISOString()};
 if(!config?.enabled||!config.encryptedToken)return {...base,status:'unconfigured',message:'Подключите доступ к отчётам Яндекс Метрики в настройках интеграции. Счётчик на сайте и доступ к его отчётам настраиваются отдельно.'};
 const cached=caches.get(days);if(send===fetch&&cached&&cached.until>Date.now())return cached.value;
 try{
  const token=decryptMetrikaToken(config.encryptedToken);
  async function query(metrics:string,dimensions='',filters=''){
   const q=new URLSearchParams({ids:String(METRIKA_COUNTER_ID),date1:days===1?'today':`${days-1}daysAgo`,date2:'today',metrics,limit:'30',accuracy:'medium',lang:'ru'});
   if(dimensions){q.set('dimensions',dimensions);q.set('sort','-'+metrics.split(',')[0]);}if(filters)q.set('filters',filters);
   const r=await send('https://api-metrika.yandex.net/stat/v1/data?'+q,{headers:{Authorization:`OAuth ${token}`},signal:AbortSignal.timeout(15000),redirect:'error',cache:'no-store'});if(!r.ok)throw Error(String(r.status));return r.json();
  }
  const [totals,pages,cities,sources,cars]=await Promise.all([
   query('ym:s:visits,ym:s:users,ym:s:pageviews'),
   query('ym:pv:pageviews','ym:pv:URLPath'),
   query('ym:s:visits','ym:s:regionCity'),
   query('ym:s:visits','ym:s:lastTrafficSource'),
   query('ym:pv:pageviews','ym:pv:URLPath,ym:pv:title,ym:pv:regionCity',"ym:pv:URLPath=@'/cars/offer/'")
  ]);
  const rows=(d:any,kind:string):AnalyticsRows=>({sampled:Boolean(d.sampled),totalRows:Number(d.total_rows)||0,rows:(d.data||[]).map((r:any)=>{const values=(r.dimensions||[]).map((x:any)=>String(x.name||'Не определено'));const path=values[0];return {label:kind==='cars'?values[1]||path:values[0],...(kind==='cars'?{detail:values[2]}:{}),...(['pages','cars'].includes(kind)&&/^\/(?!\/)/.test(path)?{path:path.split(/[?#]/)[0]}:{}),count:Number(r.metrics?.[0])||0};})});
  const value:AnalyticsReport={...base,status:'ready',totals:{visits:totals.totals[0],users:totals.totals[1],views:totals.totals[2]},pages:rows(pages,'pages'),cities:rows(cities,'cities'),sources:rows(sources,'sources'),cars:rows(cars,'cars')};if(send===fetch)caches.set(days,{until:Date.now()+300000,value});return value;
 }catch{return {...base,status:'error',message:'Метрика не передала отчёт. Проверьте доступ к счётчику и повторите загрузку. Посещения не считаются нулевыми.'};}
}
