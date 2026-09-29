'use client';
export const ANALYTICS_CHOICE_KEY='avtocena_analytics_choice_v1';
export const ANALYTICS_EVENT='avtocena:analytics-choice';
const TTL=180*86400000;
let memory:{allowed:boolean;at:number}|null=null;
export function analyticsChoice():boolean|null{
 if(typeof window==='undefined')return null;
 try{const value=JSON.parse(localStorage.getItem(ANALYTICS_CHOICE_KEY)||'null');if(value&&typeof value.allowed==='boolean'&&Number.isFinite(value.at)&&Date.now()-value.at<TTL&&value.at<=Date.now())return value.allowed;}catch{}
 return memory&&Date.now()-memory.at<TTL?memory.allowed:null;
}
export function analyticsAllowed(){return analyticsChoice()===true&&typeof location!=='undefined'&&!location.pathname.startsWith('/privacy/request');}
export function setAnalyticsChoice(allowed:boolean){
 memory={allowed,at:Date.now()};try{localStorage.setItem(ANALYTICS_CHOICE_KEY,JSON.stringify(memory));}catch{}
 if(!allowed){
  try{for(const key of ['avtocena_attribution','avtocena_ref'])localStorage.removeItem(key);for(const key of ['ac_yclid','avtocena_session_click_id'])sessionStorage.removeItem(key);}catch{}
  for(const part of document.cookie.split(';')){
   const name=part.trim().split('=')[0];if(!name.startsWith('_ym_'))continue;
   const host=location.hostname.split('.');const domains=['',...host.map((_,i)=>'; domain=.'+host.slice(i).join('.'))];
   for(const domain of domains)document.cookie=`${name}=; Max-Age=0; path=/${domain}; SameSite=Lax`;
  }
 }
 window.dispatchEvent(new Event(ANALYTICS_EVENT));
}
