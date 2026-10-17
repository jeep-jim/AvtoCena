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
function money(v){const s=clean(v);const m=s.match(/(?:¥|JPY|YEN|AUD|\$)\s*([0-9][0-9,]*)/i)||s.match(/([0-9][0-9,]*)\s*(?:JPY|YEN)/i);return m?Number(m[1].replace(/,/g,'')):0}
function lastMatch(text,re){let found=null;for(const m of text.matchAll(re))found=m;return found}
function exactStatus(text){const m=lastMatch(text,/Current Status\s*(?:-->)?\s*(Not yet available|Sold by negotiation|Not sold|Unsold(?:\s*\/\s*Passed In)?|Passed In|Sold)\b/ig);return clean(m?.[1]||'')}
function exactPriceField(text,label){const e=label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const m=lastMatch(text,new RegExp(`${e}\\s*(?:-->)?\\s*(Not yet available|[0-9][0-9,]*\\s*(?:YEN|JPY))`,'ig'));const raw=clean(m?.[1]||'');return{raw,price:money(raw),unavailable:/^not yet available$/i.test(raw)}}
function detailSummary(html,url){const text=clean(html);const imgs=images(html,url);const finalField=exactPriceField(text,'Final Price');const startField=exactPriceField(text,'Start Price');const status=exactStatus(text);const soldResult=finalField.price>0&&status==='Sold';return{url,title:clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||''),startPriceRaw:startField.raw,startPrice:startField.price,finalPriceRaw:finalField.raw,finalPrice:finalField.price,finalUnavailable:finalField.unavailable,currentStatus:status,soldResult,imageCount:imgs.length,imageSample:imgs.slice(0,12),textSample:text.slice(0,9000)}}
function venueLabel(v){return clean(v?.dataName||v?.name||v?.value||'')}

const landing=await req(PAGE);
const makes=options(landing.body,'marka_id');
const auctions=options(landing.body,'auction_name');
const toyota=makes.find(x=>/toyota/i.test(venueLabel(x)))||makes[0];
if(!toyota)throw new Error('prestige_no_make_options');
const modelsRes=await req(AJAX,{method:'POST',body:new URLSearchParams({action:'search_model_car',marka_id:toyota.value,'auction-date':'Past'}).toString(),accept:'application/json,text/plain,*/*'});
const modelsJson=parseJson(modelsRes.body);
const models=Array.isArray(modelsJson?.models)?modelsJson.models:[];
const model=models.find(x=>/^ALPHARD$/i.test(clean(x?.name)))||models.find(x=>/RAV4|COROLLA|PRIUS|LAND CRUISER/i.test(clean(x?.name)))||models[0];
if(!model?.ext_id)throw new Error(`prestige_no_models_for_make_${toyota.value}`);

const usableAuctions=auctions.filter(x=>venueLabel(x)&&!/^all$/i.test(venueLabel(x)));
const nonUss=usableAuctions.filter(x=>!/USS/i.test(venueLabel(x))).slice(0,12);
const uss=usableAuctions.filter(x=>/USS/i.test(venueLabel(x))).slice(0,4);
const venueCases=[null,...nonUss,...uss];
const searches=[];
const detailMap=new Map();
for(const venue of venueCases){
  const params=new URLSearchParams();
  params.set('action','search_results_car_dev');params.set('limit_start','0');params.set('auction-date','Past');params.set('year_from','2011');params.set('year_to','2026');params.set('marka_id',String(toyota.value));params.set('model_id',String(model.ext_id));
  if(venue)params.append('auction_name[]',String(venue.value));
  try{
    const search=await req(AJAX,{method:'POST',body:params.toString(),accept:'application/json,text/plain,*/*'});
    const json=parseJson(search.body);const carsHtml=String(json?.cars_html||'');const links=carLinks(carsHtml,PAGE);
    const row={venue:venue?{value:venue.value,label:venueLabel(venue)}:{value:'',label:'UNFILTERED'},status:search.r.status,total:json?.total??null,carsHtmlBytes:carsHtml.length,links:links.slice(0,12),plainSample:clean(carsHtml).slice(0,3500)};
    searches.push(row);
    for(const link of links.slice(0,4)){
      if(detailMap.size>=48||detailMap.has(link))continue;
      try{const d=await req(link,{referer:PAGE});detailMap.set(link,{venueFilter:row.venue,...detailSummary(d.body,d.r.url),status:d.r.status,bytes:d.body.length,contentType:d.r.headers.get('content-type')||''})}
      catch(e){detailMap.set(link,{venueFilter:row.venue,url:link,error:String(e?.message||e)})}
    }
  }catch(e){searches.push({venue:venue?{value:venue.value,label:venueLabel(venue)}:{value:'',label:'UNFILTERED'},error:String(e?.message||e)})}
}
const details=[...detailMap.values()];
const positive=details.filter(d=>Number(d.finalPrice)>0);
const unavailable=details.filter(d=>d.finalUnavailable===true);
const sold=details.filter(d=>d.soldResult===true);
const soldByNegotiation=details.filter(d=>d.currentStatus==='Sold by negotiation');
const notSold=details.filter(d=>d.currentStatus==='Not sold'||d.currentStatus==='Unsold / Passed In'||d.currentStatus==='Passed In');
const output={generatedAt:new Date().toISOString(),landing:{status:landing.r.status,bytes:landing.body.length,makeCount:makes.length,auctionCount:auctions.length,auctionOptions:auctions},selection:{make:toyota,modelCount:models.length,model,venueCases:venueCases.map(v=>v?{value:v.value,label:venueLabel(v)}:{value:'',label:'UNFILTERED'})},searches,details,summary:{detailCount:details.length,positiveFinalPriceCount:positive.length,unavailableFinalPriceCount:unavailable.length,strictSoldResultCount:sold.length,soldByNegotiationCount:soldByNegotiation.length,notSoldCount:notSold.length,strictSoldSamples:sold.slice(0,12).map(d=>({url:d.url,venueFilter:d.venueFilter,finalPrice:d.finalPrice,currentStatus:d.currentStatus,imageCount:d.imageCount}))}};
await fs.writeFile('prestige-japan-past-search-probe.json',JSON.stringify(output,null,2));
console.log(JSON.stringify({generatedAt:output.generatedAt,selection:output.selection,summary:output.summary,searches:searches.map(s=>({venue:s.venue,status:s.status,total:s.total,carsHtmlBytes:s.carsHtmlBytes,links:s.links?.length,error:s.error,plainSample:s.plainSample?.slice(0,400)})),detailSamples:details.slice(0,16).map(d=>({venueFilter:d.venueFilter,url:d.url,status:d.status,finalPrice:d.finalPrice,finalUnavailable:d.finalUnavailable,currentStatus:d.currentStatus,soldResult:d.soldResult,imageCount:d.imageCount,error:d.error}))},null,2));
