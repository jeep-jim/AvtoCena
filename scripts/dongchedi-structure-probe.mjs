import fs from 'node:fs/promises';

const BASE='https://www.dongchedi.com';
const URLS=[
 `${BASE}/usedcar`,
 `${BASE}/usedcar/sale`,
 `${BASE}/auto/library/x-x-x-x-x-x-x-x-x-x-x`,
 `${BASE}/auto/library/x-x-x-x-x-x-x-x-x-x-x-x-x-x-x`,
];
const H={accept:'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8','accept-language':'zh-CN,zh;q=0.9,en;q=0.7','cache-control':'no-cache',pragma:'no-cache','user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'};
function clean(v){return String(v??'').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()}
function abs(v,b=BASE){try{return new URL(String(v).replace(/&amp;/g,'&'),b).toString()}catch{return''}}
async function get(url,referer=BASE){const r=await fetch(url,{headers:{...H,referer},redirect:'follow',signal:AbortSignal.timeout(30000)});const body=await r.text();return{r,body}}
function links(body,base){return [...new Set([...body.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].map(m=>abs(m[1],base)).filter(Boolean))]}
function endpoints(body,base){const vals=[];for(const m of body.matchAll(/https?:\\?\/\\?\/[^"'`\\\s<>]+/gi))vals.push(m[0].replace(/\\\//g,'/'));for(const m of body.matchAll(/["'`](\/[^"'`]*(?:api|usedcar|search|list|feed|vehicle|car|series)[^"'`]*)["'`]/gi))vals.push(m[1].replace(/\\\//g,'/'));return[...new Set(vals.map(v=>abs(v,base)).filter(v=>/dongchedi|byteimg|snssdk|toutiao/i.test(v)))].slice(0,250)}
function contexts(body,terms,radius=1500,max=6){const out=[];const low=body.toLowerCase();for(const t of terms){let p=0,n=0;while(n<max){const i=low.indexOf(t.toLowerCase(),p);if(i<0)break;out.push({term:t,context:body.slice(Math.max(0,i-radius),Math.min(body.length,i+radius))});p=i+t.length;n++}}return out}
const out={generatedAt:new Date().toISOString(),pages:[],bundles:[]};
const scripts=new Set();
for(const url of URLS){try{const {r,body}=await get(url);const allLinks=links(body,r.url);const scriptUrls=[...body.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m=>abs(m[1],r.url)).filter(Boolean);scriptUrls.forEach(s=>scripts.add(s));out.pages.push({url,status:r.status,finalUrl:r.url,bytes:body.length,contentType:r.headers.get('content-type')||'',title:clean(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||''),hasLogin:/登录|扫码登录|手机号登录|login/i.test(clean(body).slice(0,5000)),hasCaptcha:/captcha|验证码|verify/i.test(body),hasNextData:/__NEXT_DATA__/i.test(body),hasNextFlight:/self\.__next_f\.push/i.test(body),hasSSR:/__INITIAL_STATE__|window\._SSR_DATA|SSR_DATA|__NUXT__/i.test(body),usedcarLinks:allLinks.filter(u=>/\/usedcar\//i.test(u)).slice(0,40),seriesLinks:allLinks.filter(u=>/\/auto\/series\/\d+/i.test(u)).slice(0,40),endpoints:endpoints(body,r.url),contexts:contexts(body,['usedcar','vehicle_id','car_id','series_id','search','api/','fetch(','axios','list','page_size','offset'],1100,4).map(x=>({term:x.term,context:x.context.slice(0,4200)})),scripts:scriptUrls.slice(0,80)});}catch(e){out.pages.push({url,error:String(e?.message||e)})}}
for(const url of [...scripts].slice(0,100)){try{const {r,body}=await get(url,BASE);if(!/usedcar|vehicle_id|car_id|series_id|page_size|offset|search|\/api\/|api\./i.test(body))continue;out.bundles.push({url,status:r.status,bytes:body.length,endpoints:endpoints(body,url),contexts:contexts(body,['usedcar','vehicle_id','car_id','series_id','page_size','offset','search','api/','fetch(','axios'],1800,8).map(x=>({term:x.term,context:x.context.slice(0,6000)}))});}catch(e){out.bundles.push({url,error:String(e?.message||e)})}}
await fs.writeFile('dongchedi-structure-probe.json',JSON.stringify(out,null,2));
console.log(JSON.stringify({generatedAt:out.generatedAt,pages:out.pages.map(p=>({url:p.url,status:p.status,finalUrl:p.finalUrl,bytes:p.bytes,title:p.title,hasLogin:p.hasLogin,hasCaptcha:p.hasCaptcha,hasNextData:p.hasNextData,hasNextFlight:p.hasNextFlight,hasSSR:p.hasSSR,usedcarLinks:p.usedcarLinks?.length,seriesLinks:p.seriesLinks?.length,endpoints:p.endpoints?.slice(0,20),error:p.error})),bundles:out.bundles.map(b=>({url:b.url,status:b.status,bytes:b.bytes,endpoints:b.endpoints?.slice(0,30),error:b.error}))},null,2));
