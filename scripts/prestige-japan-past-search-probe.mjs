import fs from 'node:fs/promises';

const BASE='https://prestigemotorsport.com.au';
const PAGE=`${BASE}/auctions/`;
const AJAX=`${BASE}/wp-admin/admin-ajax.php`;
const H={accept:'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8','accept-language':'en-US,en;q=0.9','cache-control':'no-cache',pragma:'no-cache','user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'};
function clean(v){return String(v??'').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()}
function abs(v,b=BASE){try{return new URL(String(v).replace(/&amp;/g,'&'),b).toString()}catch{return''}}
async function req(url,{method='GET',body,referer=PAGE,accept=H.accept}={}){const r=await fetch(url,{method,body,headers:{...H,accept,referer,...(method==='POST'?{'content-type':'application/x-www-form-urlencoded; charset=UTF-8','x-requested-with':'XMLHttpRequest',origin:BASE}:{})},redirect:'follow',signal:AbortSignal.timeout(30000)});return{r,body:await r.text()}}
function selectHtml(page,id){const e=id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return page.match(new RegExp(`<select\\b[^>]*id=["']${e}["'][^>]*>([\\s\\S]*?)<\\/select>`,'i'))?.[1]||''}
function options(page,id){return[...selectHtml(page,id).matchAll(/<option\b([^>]*)value=["']([^"']*)["']([^>]*)>([\s\S]*?)<\/option>/gi)].map(m=>({value:m[2],name:clean(m[4]),attrs:`${m[1]} ${m[3]}`.replace(/\s+/g,' ').trim(),dataName:(`${m[1]} ${m[3]}`.match(/data-name=["']([^"']+)/i)?.[1]||'')})).filter(x=>x.value)}
function parseJson(body){try{return JSON.parse(body)}catch{return null}}
function carLinks(html,base){return[...new Set([...html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].map(m=>abs(m[1],base)).filter(u=>/auction-vehicle-display|[?&]vid=|\/auction[^?#]*vehicle/i.test(u)))]}
function images(html,base){const vals=[];for(const m of html.matchAll(/(?:src|data-src|data-original|data-lazy-src|content)=["']([^"']+)["']/gi))vals.push(m[1]);for(const m of html.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'\\\s<>]*)?/gi))vals.push(m[0].replace(/\\\//g,'/'));return[...new Set(vals.map(v=>abs(v,base)).filter(u=>/^https?:/i.test(u)&&!/logo|favicon|icon|sprite|banner|placeholder|avatar|tracking|pixel|qrcode|car_no_image/i.test(u)))]}
function labeled(text,label){const e=label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return text.match(new RegExp(`${e}\\s*:?\\s*([^|]{1,180}?)(?=\\s{2,}|Auction |Start Price|Final Price|Current Status|Chassis|Model Code|Engine|Kilometers|KM|Grade|Year|$)`,'i'))?.[1]?.trim()||''}
function money(v){const s=clean(v);const m=s.match(/(?:¥|JPY|YEN|AUD|\$)\s*([0-9][0-9,]*)/i)||s.match(/([0-9][0-9,]*)\s*(?:JPY|YEN)/i);return m?Number(m[1].replace(/,/g,'')):0}
function detailSummary(html,url){const text=clean(html);const imgs=images(html,url);return{url,title:clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||''),auctionLocation:labeled(text,'Auction Location'),auctionDate:labeled(text,'Auction Date'),auctionGrade:labeled(text,'Auction Grade'),modelCode:labeled(text,'Model Code'),chassis:labeled(text,'Chassis'),kilometers:labeled(text,'Kilometers')||labeled(text,'KM'),engine:labeled(text,'Engine'),startPriceRaw:labeled(text,'Start Price'),startPrice:money(labeled(text,'Start Price')),finalPriceRaw:labeled(text,'Final Price'),finalPrice:money(labeled(text,'Final Price')),currentStatus:labeled(text,'Current Status'),imageCount:imgs.length,imageSample:imgs.slice(0,30),textSample:text.slice(0,10000)} }

const landing=await req(PAGE);
const makes=options(landing.body,'marka_id');
const preferred=makes.find(x=>/toyota/i.test(x.name||x.dataName))||makes.find(x=>/nissan|honda|mazda|subaru/i.test(x.name||x.dataName))||makes[0];
if(!preferred)throw new Error('prestige_no_make_options');
const modelBody=new URLSearchParams({action:'search_model_car',marka_id:preferred.value,'auction-date':'Past'}).toString();
const modelsRes=await req(AJAX,{method:'POST',body:modelBody,accept:'application/json,text/plain,*/*'});
const modelsJson=parseJson(modelsRes.body);
const models=Array.isArray(modelsJson?.models)?modelsJson.models:[];
const preferredModel=models.find(x=>/rav4|corolla|land cruiser|prius|alphard/i.test(String(x?.name||'')))||models[0];
if(!preferredModel?.ext_id)throw new Error(`prestige_no_models_for_make_${preferred.value}`);

const params=new URLSearchParams();
params.set('action','search_results_car_dev');params.set('limit_start','0');params.set('auction-date','Past');params.set('year_from','2011');params.set('year_to','2026');params.set('marka_id',String(preferred.value));params.set('model_id',String(preferredModel.ext_id));
const search=await req(AJAX,{method:'POST',body:params.toString(),accept:'application/json,text/plain,*/*'});
const json=parseJson(search.body);
const carsHtml=String(json?.cars_html||'');
const links=carLinks(carsHtml,PAGE);
const output={generatedAt:new Date().toISOString(),landing:{status:landing.r.status,bytes:landing.body.length,makeCount:makes.length,makeSample:makes.slice(0,20)},selection:{make:preferred,modelCount:models.length,model:preferredModel,modelSample:models.slice(0,30)},search:{status:search.r.status,contentType:search.r.headers.get('content-type')||'',bytes:search.body.length,total:json?.total,carsHtmlBytes:carsHtml.length,links:links.slice(0,100),plainSample:clean(carsHtml).slice(0,12000)},details:[]};
for(const link of links.slice(0,5)){
 try{const d=await req(link,{referer:PAGE});output.details.push({...detailSummary(d.body,d.r.url),status:d.r.status,bytes:d.body.length,contentType:d.r.headers.get('content-type')||''})}
 catch(e){output.details.push({url:link,error:String(e?.message||e)})}
}
await fs.writeFile('prestige-japan-past-search-probe.json',JSON.stringify(output,null,2));
console.log(JSON.stringify({generatedAt:output.generatedAt,selection:output.selection,search:{status:output.search.status,total:output.search.total,carsHtmlBytes:output.search.carsHtmlBytes,links:output.search.links.slice(0,20),plainSample:output.search.plainSample.slice(0,4000)},details:output.details.map(d=>({url:d.url,status:d.status,title:d.title,auctionLocation:d.auctionLocation,auctionDate:d.auctionDate,auctionGrade:d.auctionGrade,modelCode:d.modelCode,chassis:d.chassis,kilometers:d.kilometers,engine:d.engine,startPriceRaw:d.startPriceRaw,startPrice:d.startPrice,finalPriceRaw:d.finalPriceRaw,finalPrice:d.finalPrice,currentStatus:d.currentStatus,imageCount:d.imageCount,error:d.error}))},null,2));
