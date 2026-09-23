"use client";
export const METRIKA_COUNTER = 112098062;
const digits = (value: unknown) => typeof value === 'string' && /^\d{1,32}$/.test(value) ? value : '';
export function rememberYandexClick() {
 try {const id=digits(new URLSearchParams(location.search).get('yclid'));if(id)sessionStorage.setItem('ac_yclid',id);} catch {}
}
export async function metrikaAttribution() {
 rememberYandexClick();
 let clientId='';let yclid='';
 try {clientId=digits(document.cookie.match(/(?:^|;\s*)_ym_uid=(\d+)/)?.[1]);yclid=digits(sessionStorage.getItem('ac_yclid'));}catch{}
 if(window.ym) clientId=await new Promise<string>(resolve=>{
  const timer=setTimeout(()=>resolve(clientId),400);
  try {window.ym?.(METRIKA_COUNTER,'getClientID',(id:unknown)=>{clearTimeout(timer);resolve(digits(id)||clientId);});}catch{clearTimeout(timer);resolve(clientId);}
 });
 return {metrikaClientId:clientId,yclid};
}
