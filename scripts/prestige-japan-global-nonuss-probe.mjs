import fs from 'node:fs/promises';

const BASE='https://prestigemotorsport.com.au';
const PAGE=`${BASE}/auctions/`;
const AJAX=`${BASE}/wp-admin/admin-ajax.php`;
const H={accept:'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8','accept-language':'en-US,en;q=0.9','cache-control':'no-cache',pragma:'no-cache','user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'};
function clean(v){return String(v??'').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()}
function abs(v,b=BASE){try{return new URL(String(v).replace(/&amp;/g,'&'),b).toString()}catch{return''}}
async function req(url,{method='GET',body,referer=PAGE,accept=H.accept}={}){const r=await fetch(url,{method,body,headers:{...H,accept,referer,...(method==='POST'?{'content-type':'application/x-www-form-urlencoded; charset=UTF-8','x-requested-with':'XMLHttpRequest',origin:BASE}:{})},redirect:'follow',signal:AbortSignal.timeout(30000)});return{r,body:await r.text()}}
function parseJson(body){try{return JSON.parse(body)}catch{return null}}
function carLinks(html){return[...new Set([...html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].map(m=>abs(m[1],PAGE)).filter(u=>/auction-vehicle-display\/\?car_id=/i.test(u)))]}
function money(v){const s=clean(v);const m=s.match(/([0-9][0-9,]*)\s*(?:YEN|JPY)/i);return m?Number(m[1].replace(/,/g,'')):0}
function lastMatch(text,re){let found=null;for(const m of text.matchAll(re))found=m;return found}
function status(text){return clean(lastMatch(text,/Current Status\s*(?:-->)?\s*(Not yet available|Sold by negotiation|Not sold|Unsold(?:\s*\/\s*Passed In)?|Passed In|Sold)\b/ig)?.[1]||'')}
function finalPrice(text){const raw=clean(lastMatch(text,/Final Price\s*(?:-->)?\s*(Not yet available|[0-9][0-9,]*\s*(?:YEN|JPY))/ig)?.[1]||'');return{raw,price:money(raw)}}
function summaryFromDetail(html,url){const text=clean(html);const f=finalPrice(text);const s=status(text);const title=text.match(/Japanese Auction Vehicle Details\s+((?:19|20)\d{2}\s+[^|]{3,160}?)(?=\s+Year\s+(?:19|20)\d{2})/i)?.[1]||'';const auctionDate=text.match(/Auction Date\s+((?:0?[1-9]|[12]\d|3[01])-(?:0?[1-9]|1[0-2])-(?:19|20)\d{2})/i)?.[1]||'';const location=text.match(/Location\s+([^|]{2,80}?)(?=\s+(?:Start Price|Final Price|Current Status|Send ENQUIRY))/i)?.[1]||'';const lot=text.match(/Number\s+([A-Z0-9-]{1,30})/i)?.[1]||'';const imgs=[...new Set([...html.matchAll(/(?:src|data-src|data-original)=["']([^"']+)["']/gi)].map(m=>abs(m[1],url)).filter(u=>/^https?:/i.test(u)&&!/(?:logo|icon|favicon|banner|sprite|tracking|pixel|qrcode|placeholder)/i.test(u)))];return{url,title:clean(title),auctionDate,location:clean(location),lot,finalPrice:f.price,finalPriceRaw:f.raw,currentStatus:s,soldResult:f.price>0&&s==='Sold',imageCount:imgs.length}}

const landing=await req(PAGE);
const offsets=[0,20,40,60];
const pages=[];
const detailMap=new Map();
for(const offset of offsets){
  const p=new URLSearchParams();
  p.set('action','search_results_car_dev');
  p.set('limit_start',String(offset));
  p.set('auction-date','Past');
  p.set('year_from','2011');
  p.set('year_to','2026');
  p.append('auction_name[]','2');
  const res=await req(AJAX,{method:'POST',body:p.toString(),accept:'application/json,text/plain,*/*'});
  const json=parseJson(res.body);const html=String(json?.cars_html||'');const links=carLinks(html);
  pages.push({offset,status:res.r.status,total:json?.total??null,carsHtmlBytes:html.length,linkCount:links.length,links:links.slice(0,30),plainSample:clean(html).slice(0,3500)});
  for(const link of links.slice(0,6)){
    if(detailMap.has(link))continue;
    try{const d=await req(link,{referer:PAGE});detailMap.set(link,{...summaryFromDetail(d.body,d.r.url),httpStatus:d.r.status})}
    catch(e){detailMap.set(link,{url:link,error:String(e?.message||e)})}
  }
}
const details=[...detailMap.values()];
const allLinks=pages.flatMap(p=>p.links);
const uniqueLinks=new Set(allLinks);
const overlap=allLinks.length-uniqueLinks.size;
const sold=details.filter(d=>d.soldResult);
const output={generatedAt:new Date().toISOString(),landing:{status:landing.r.status,bytes:landing.body.length},query:{auctionDate:'Past',yearFrom:2011,yearTo:2026,auctionName:'2',meaning:'Non-USS only'},pages,summary:{offsets,linkCount:allLinks.length,uniqueLinkCount:uniqueLinks.size,duplicateLinksAcrossOffsets:overlap,detailCount:details.length,strictSoldResultCount:sold.length,strictSoldSamples:sold.slice(0,12)},details};
await fs.writeFile('prestige-japan-global-nonuss-probe.json',JSON.stringify(output,null,2));
console.log(JSON.stringify({generatedAt:output.generatedAt,query:output.query,pages:pages.map(p=>({offset:p.offset,status:p.status,total:p.total,carsHtmlBytes:p.carsHtmlBytes,linkCount:p.linkCount,firstLinks:p.links.slice(0,4),plainSample:p.plainSample.slice(0,600)})),summary:output.summary,detailSamples:details.slice(0,12)},null,2));
