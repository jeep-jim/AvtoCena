'use client';
import {isPublicPagePath} from './public-page-url';
export const ANALYTICS_CHOICE_KEY='avtocena_analytics_choice_v1';
export const ANALYTICS_CONSENT_VERSION='analytics-consent-2026-10-03';
export const ANALYTICS_EVENT='avtocena:analytics-choice';
const TTL=180*86400000;
let memory:{allowed:boolean;at:number;version:string}|null=null;
export function analyticsChoice():boolean|null{
 if(typeof window==='undefined')return null;
 try{const value=JSON.parse(localStorage.getItem(ANALYTICS_CHOICE_KEY)||'null');if(value&&typeof value.allowed==='boolean'&&Number.isFinite(value.at)&&(value.allowed===false||(value.version===ANALYTICS_CONSENT_VERSION&&Date.now()-value.at<TTL))&&value.at<=Date.now())return value.allowed;}catch{}
 return memory&&(memory.allowed===false||Date.now()-memory.at<TTL)?memory.allowed:null;
}
// Optional analytics needs an explicit choice for this consent version.
// Preserve old refusals; old automatic allowances must be confirmed again.
export function pageAnalyticsAllowed(){return typeof location!=='undefined'&&isPublicPagePath(location.pathname)&&!location.pathname.startsWith('/privacy/request')&&analyticsChoice()===true;}
export function enablePageAnalytics(){
 setAnalyticsChoice(true);
}
export function analyticsAllowed(){return analyticsChoice()===true&&typeof location!=='undefined'&&isPublicPagePath(location.pathname)&&!location.pathname.startsWith('/privacy/request');}
export function setAnalyticsChoice(allowed:boolean){
 memory={allowed,at:Date.now(),version:ANALYTICS_CONSENT_VERSION};try{localStorage.setItem(ANALYTICS_CHOICE_KEY,JSON.stringify(memory));}catch{}
 if(!allowed){
  window.dispatchEvent(new Event(ANALYTICS_EVENT));
  try{for(let i=localStorage.length-1;i>=0;i--){const key=localStorage.key(i);if(key?.startsWith('_ym'))localStorage.removeItem(key);}}catch{}
  try{for(const key of ['avtocena_attribution','avtocena_ref'])localStorage.removeItem(key);for(const key of ['ac_yclid','avtocena_session_click_id'])sessionStorage.removeItem(key);}catch{}
  for(const part of document.cookie.split(';')){
   const name=part.trim().split('=')[0];if(!name.startsWith('_ym_'))continue;
   const host=location.hostname.split('.');const domains=['',...host.map((_,i)=>'; domain=.'+host.slice(i).join('.'))];
   for(const domain of domains)document.cookie=`${name}=; Max-Age=0; path=/${domain}; SameSite=Lax`;
  }
 }
 window.dispatchEvent(new Event(ANALYTICS_EVENT));
}
