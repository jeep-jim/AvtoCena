import {isPublicPagePath} from './public-page-url';

export const METRIKA_COUNTER_ID=112098062;
export const METRIKA_PAGE_EVENT='avtocena:metrika-page';
const campaignKeys=['utm_source','utm_medium','utm_campaign','utm_content','utm_term','yclid'];

/** Keep advertising attribution, never arbitrary form, authentication or Mini App parameters. */
export function metrikaPageUrl(href:string):string {
 try {
  const url=new URL(href);
  if(!['http:','https:'].includes(url.protocol)||!isPublicPagePath(url.pathname)||url.pathname.startsWith('/privacy/request'))return '';
  const clean=new URL(url.origin+url.pathname);
  for(const key of campaignKeys){
   const value=url.searchParams.get(key);
   if(!value||value.length>200||/[\u0000-\u001f@<>]/.test(value))continue;
   if(key==='yclid'&&!/^\d{1,32}$/.test(value))continue;
   clean.searchParams.set(key,value);
  }
  return clean.href;
 }catch{return '';}
}

type Adapter={
 allowed:()=>boolean;
 href:()=>string;
 referrer:()=>string;
 send:(...args:unknown[])=>void;
 load:()=>void;
 disable:(disabled:boolean)=>void;
};

/** One init per active counter, one hit per distinct SPA URL. */
export function createMetrikaPageTracker(adapter:Adapter){
 let active=false;
 let previous='';
 const stop=()=>{
  adapter.disable(true);
  if(active)adapter.send(METRIKA_COUNTER_ID,'destruct');
  active=false;previous='';
 };
 const sync=()=>{
  const url=metrikaPageUrl(adapter.href());
  if(!adapter.allowed()||!url){stop();return;}
  adapter.disable(false);
  adapter.load();
  if(!active){
   adapter.send(METRIKA_COUNTER_ID,'init',{
    ssr:true,clickmap:false,trackLinks:false,disableYtm:true,
    ecommerce:false,accurateTrackBounce:15000,
    url,referrer:metrikaPageUrl(adapter.referrer()),
   });
   active=true;previous=url;return;
  }
  if(url===previous)return;
  adapter.send(METRIKA_COUNTER_ID,'hit',url,{referer:previous});
  previous=url;
 };
 return {sync,stop};
}
