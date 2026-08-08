import fs from 'node:fs/promises';

const BASE='https://prestigemotorsport.com.au';
const PAGE=`${BASE}/auctions/`;
const H={accept:'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8','accept-language':'en-US,en;q=0.9','cache-control':'no-cache',pragma:'no-cache','user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'};
function abs(v,b=BASE){try{return new URL(String(v).replace(/&amp;/g,'&'),b).toString()}catch{return''}}
function clean(v){return String(v??'').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()}
async function request(url,{referer=BASE,accept=H.accept,method='GET',body,headers={}}={}){const r=await fetch(url,{method,body,headers:{...H,referer,accept,...headers},redirect:'follow',signal:AbortSignal.timeout(30000)});return{r,body:await r.text()}}
function endpoints(body,base){const vals=[];for(const m of body.matchAll(/https?:\\?\/\\?\/[^"'`\\\s<>]+/gi))vals.push(m[0].replace(/\\\//g,'/'));for(const m of body.matchAll(/["'`](\/[^"'`]*(?:ajax|api|auction|search|vehicle|wordpress|wp-json|admin-ajax)[^"'`]*)["'`]/gi))vals.push(m[1].replace(/\\\//g,'/'));return[...new Set(vals.map(v=>abs(v,base)).filter(v=>/^https?:/i.test(v)))].slice(0,400)}
function contexts(body,terms,radius=2200,max=14){const out=[];const low=body.toLowerCase();for(const term of terms){let pos=0,n=0;while(n<max){const i=low.indexOf(term.toLowerCase(),pos);if(i<0)break;out.push({term,context:body.slice(Math.max(0,i-radius),Math.min(body.length,i+radius))});pos=i+term.length;n++}}return out}
function scripts(body,base){return[...new Set([...body.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m=>abs(m[1],base)).filter(Boolean))]}
function inlineScripts(body){return[...body.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m,i)=>({i,body:m[1]})).filter(x=>x.body.trim())}
function forms(body){return[...body.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].map((m,i)=>({i,attrs:m[1],action:m[1].match(/action=["']([^"']+)/i)?.[1]||'',method:m[1].match(/method=["']([^"']+)/i)?.[1]||'',inputs:[...m[2].matchAll(/<(?:input|select|button)\b([^>]*)>/gi)].map(x=>({name:x[1].match(/name=["']([^"']+)/i)?.[1]||'',id:x[1].match(/id=["']([^"']+)/i)?.[1]||'',value:x[1].match(/value=["']([^"']*)/i)?.[1]||'',type:x[1].match(/type=["']([^"']+)/i)?.[1]||''})).filter(x=>x.name||x.id).slice(0,180)})).filter(f=>/auction|search|vehicle|date|maker|model|location|past/i.test(JSON.stringify(f))).slice(0,30)}
function ajaxSignals(body){
  const terms=['search_cars_action','jas-search-form','auction_date_select','auction-date','marka_id','model_id','admin-ajax.php','ajaxurl','wp_ajax','action:',"action =",'serialize()','.serialize(','$.ajax','jQuery.ajax','fetch(','vehicle-display','vid='];
  return contexts(body,terms,2600,20).map(x=>({term:x.term,context:x.context.slice(0,9000)}));
}
function actionNames(body){
  const vals=[];
  for(const m of body.matchAll(/action\s*[:=]\s*["']([^"']+)["']/gi)) vals.push(m[1]);
  for(const m of body.matchAll(/["']action["']\s*:\s*["']([^"']+)["']/gi)) vals.push(m[1]);
  for(const m of body.matchAll(/wp_ajax_(?:nopriv_)?([A-Za-z0-9_-]+)/g)) vals.push(m[1]);
  return [...new Set(vals)].filter(Boolean).slice(0,100);
}
function nonces(body){
  const vals=[];
  for(const m of body.matchAll(/(?:nonce|security|_ajax_nonce|ajax_nonce)["']?\s*[:=]\s*["']([A-Za-z0-9_-]{5,})["']/gi)) vals.push(m[1]);
  return [...new Set(vals)].slice(0,50);
}
function resultHints(body,base){
  const links=[...new Set([...body.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].map(m=>abs(m[1],base)).filter(Boolean))];
  return {
    vehicleLinks:links.filter(u=>/auction-vehicle-display|[?&]vid=|\/auction[^?#]*vehicle|\/vehicle\//i.test(u)).slice(0,100),
    finalPriceContexts:contexts(body,['Final Price','Current Status','Auction Grade','Chassis','Start Price','Sale Price','Sold'],1200,10).map(x=>({term:x.term,context:clean(x.context).slice(0,4500)})),
  };
}

const page=await request(PAGE);
const scriptUrls=scripts(page.body,page.r.url);
const inline=inlineScripts(page.body);
const out={
  generatedAt:new Date().toISOString(),
  page:{
    status:page.r.status,finalUrl:page.r.url,bytes:page.body.length,title:clean(page.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||''),
    forms:forms(page.body),endpoints:endpoints(page.body,page.r.url),scripts:scriptUrls,
    ajaxSignals:ajaxSignals(page.body),actionNames:actionNames(page.body),nonces:nonces(page.body),
    inlineScripts:inline.filter(x=>/search_cars_action|jas-search-form|auction_date_select|marka_id|admin-ajax|ajaxurl|wp_ajax|auction-date/i.test(x.body)).map(x=>({i:x.i,bytes:x.body.length,signals:ajaxSignals(x.body),actions:actionNames(x.body),nonces:nonces(x.body),body:x.body.slice(0,30000)})),
  },
  bundles:[],
  directProbes:[],
};
for(const url of scriptUrls){
  try{
    const {r,body}=await request(url,{referer:PAGE});
    if(!/search_cars_action|jas-search-form|auction_date_select|marka_id|admin-ajax|ajaxurl|wp_ajax|auction-date|vehicle-display|vid=/i.test(body))continue;
    out.bundles.push({url,status:r.status,bytes:body.length,endpoints:endpoints(body,url),signals:ajaxSignals(body),actions:actionNames(body),nonces:nonces(body)});
  }catch(e){out.bundles.push({url,error:String(e?.message||e)})}
}

const candidateEndpoints=[...new Set([
  ...out.page.endpoints.filter(u=>/admin-ajax|wp-json|auction/i.test(u)),
  ...out.bundles.flatMap(b=>b.endpoints||[]).filter(u=>/admin-ajax|wp-json|auction/i.test(u)),
])];
const candidateActions=[...new Set([...out.page.actionNames,...out.page.inlineScripts.flatMap(x=>x.actions||[]),...out.bundles.flatMap(b=>b.actions||[])])]
  .filter(a=>/auction|car|search|vehicle|jas/i.test(a));
const nonce=out.page.nonces[0]||out.page.inlineScripts.flatMap(x=>x.nonces||[])[0]||out.bundles.flatMap(b=>b.nonces||[])[0]||'';

for(const endpoint of candidateEndpoints.slice(0,20)){
  if(!/admin-ajax\.php/i.test(endpoint))continue;
  for(const action of candidateActions.slice(0,20)){
    const params=new URLSearchParams();
    params.set('action',action);params.set('auction-date','Past');params.set('year_from','2011');params.set('year_to','2026');
    if(nonce){params.set('nonce',nonce);params.set('security',nonce);params.set('_ajax_nonce',nonce)}
    try{
      const {r,body}=await request(endpoint,{referer:PAGE,method:'POST',body:params.toString(),accept:'application/json,text/html,*/*',headers:{'content-type':'application/x-www-form-urlencoded; charset=UTF-8','x-requested-with':'XMLHttpRequest'}});
      const hints=resultHints(body,r.url||endpoint);
      out.directProbes.push({endpoint,action,status:r.status,contentType:r.headers.get('content-type')||'',bytes:body.length,preview:clean(body).slice(0,4000),vehicleLinks:hints.vehicleLinks,finalPriceContexts:hints.finalPriceContexts});
    }catch(e){out.directProbes.push({endpoint,action,error:String(e?.message||e)})}
  }
}

await fs.writeFile('prestige-japan-contract-probe.json',JSON.stringify(out,null,2));
console.log(JSON.stringify({generatedAt:out.generatedAt,page:{status:out.page.status,bytes:out.page.bytes,title:out.page.title,actions:out.page.actionNames,nonces:out.page.nonces,inlineCount:out.page.inlineScripts.length},bundles:out.bundles.map(b=>({url:b.url,status:b.status,bytes:b.bytes,actions:b.actions,endpoints:b.endpoints?.filter(u=>/admin-ajax|wp-json|auction/i.test(u)).slice(0,40),error:b.error})),directProbes:out.directProbes.map(p=>({endpoint:p.endpoint,action:p.action,status:p.status,bytes:p.bytes,contentType:p.contentType,vehicleLinks:p.vehicleLinks?.slice(0,10),finalPriceContexts:p.finalPriceContexts?.slice(0,3),error:p.error}))},null,2));
