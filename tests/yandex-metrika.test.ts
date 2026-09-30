import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {createMetrikaPageTracker,metrikaPageUrl} from '../apps/web/lib/metrika-pageviews';
import {analyticsAllowed,analyticsChoice,pageAnalyticsAllowed,ANALYTICS_CHOICE_KEY} from '../apps/web/lib/privacy-consent';

const root=fs.readFileSync('apps/web/app/layout.tsx','utf8');
const layout=fs.readFileSync('apps/web/app/(public)/layout.tsx','utf8');
const footer=fs.readFileSync('apps/web/components/layout/PublicLegalFooter.tsx','utf8');
test('counter remains in public layout and cookie settings never open automatically',()=>{
 assert.match(layout,/<ConsentMetrika \/>/);assert.doesNotMatch(root,/112098062/);
 assert.match(footer,/Настройки cookie/);assert.match(footer,/useState\(false\)/);
 assert.doesNotMatch(footer,/<aside className="ac-cookie-banner"|setCookieBannerOpen/);
});
test('new visitor has page statistics but no invented permission to link a lead; old refusal persists',()=>{
 const originals=['window','location','localStorage'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
 let choice:string|null=null;
 try{
  Object.defineProperty(globalThis,'window',{configurable:true,value:{}});
  Object.defineProperty(globalThis,'location',{configurable:true,value:{pathname:'/'}});
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>key===ANALYTICS_CHOICE_KEY?choice:null}});
  assert.equal(pageAnalyticsAllowed(),true);assert.equal(analyticsChoice(),null);assert.equal(analyticsAllowed(),false);
  choice=JSON.stringify({allowed:false,at:Date.now()-365*86400000});assert.equal(pageAnalyticsAllowed(),false);
  choice=JSON.stringify({allowed:true,at:Date.now()});assert.equal(pageAnalyticsAllowed(),true);assert.equal(analyticsAllowed(),true);
  (globalThis as any).location.pathname='/privacy/request';assert.equal(pageAnalyticsAllowed(),false);
  (globalThis as any).location.pathname='/crm';assert.equal(pageAnalyticsAllowed(),false);
 }finally{for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete (globalThis as any)[key];}}
});
test('advertising URLs preserve UTM and yclid but discard arbitrary query and hash',()=>{
 const url=metrikaPageUrl('https://avtocena.com/cars?phone=79999999999&token=secret&tgWebAppData=secret&utm_source=yandex&utm_campaign=123&yclid=987#contact');
 assert.equal(url,'https://avtocena.com/cars?utm_source=yandex&utm_campaign=123&yclid=987');
 assert.equal(metrikaPageUrl('https://avtocena.com/?utm_source=a%40b.ru&yclid=bad'), 'https://avtocena.com/');
 for(const path of ['/crm/leads/123','/login','/privacy/request','/api/leads'])assert.equal(metrikaPageUrl('https://avtocena.com'+path),'');
 assert.equal(metrikaPageUrl('javascript:alert(1)'),'');
});
test('immediate first hit, 15-second bounce tracking and SPA hits without duplicate initialization',()=>{
 let href='https://avtocena.com/?utm_source=yandex&yclid=123';let allowed=true;
 const calls:unknown[][]=[];const disabled:boolean[]=[];
 const tracker=createMetrikaPageTracker({href:()=>href,allowed:()=>allowed,referrer:()=> 'https://yandex.ru/?secret=removed',send:(...args)=>calls.push(args),load:()=>{},disable:v=>disabled.push(v)});
 tracker.sync();tracker.sync();
 assert.equal(calls.length,1);assert.equal(calls[0][1],'init');
 assert.equal((calls[0][2] as any).accurateTrackBounce,15000);assert.equal((calls[0][2] as any).webvisor,false);
 assert.equal((calls[0][2] as any).url,href);assert.equal((calls[0][2] as any).referrer,'https://yandex.ru/');
 href='https://avtocena.com/cars';tracker.sync();tracker.sync();assert.equal(calls.length,2);assert.equal(calls[1][1],'hit');
 allowed=false;tracker.sync();assert.equal(calls.at(-1)?.[1],'destruct');assert.equal(disabled.at(-1),true);
 const before=calls.length;href='https://avtocena.com/favorites';tracker.sync();assert.equal(calls.length,before);
 allowed=true;tracker.sync();assert.equal(calls.at(-1)?.[1],'init');assert.equal(disabled.at(-1),false);
 href='https://avtocena.com/privacy/request?token=private';tracker.sync();assert.equal(calls.at(-1)?.[1],'destruct');
 href='https://avtocena.com/cars';tracker.sync();assert.equal(calls.at(-1)?.[1],'init');
});
