import fs from 'node:fs/promises';

const LIST = 'https://car.autohome.com.cn/price/list-0-0-0-0-0-0-0-0-0-0-0-0-0-0-0-1.html';
const IDS = ['75949','77527','77526'];
const H = { accept:'text/html,application/xhtml+xml,*/*;q=0.8','accept-language':'zh-CN,zh;q=0.9,en;q=0.7','cache-control':'no-cache',pragma:'no-cache','user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36' };
async function get(url, referer='https://www.autohome.com.cn/') { const r=await fetch(url,{headers:{...H,referer},redirect:'follow',signal:AbortSignal.timeout(30000)}); const b=new Uint8Array(await r.arrayBuffer()); const head=new TextDecoder('latin1').decode(b.slice(0,1000)); const gb=/(?:gb2312|gbk|gb18030)/i.test(r.headers.get('content-type')||'')||/(?:gb2312|gbk|gb18030)/i.test(head); return {r,body:new TextDecoder(gb?'gb18030':'utf-8').decode(b),bytes:b.length}; }
function clean(s){return String(s??'').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();}
function abs(v,base){try{return new URL(String(v).replace(/&amp;/g,'&'),base).toString()}catch{return''}}
function around(html, needle, before=5000, after=9000){const i=html.indexOf(needle);return i<0?'':html.slice(Math.max(0,i-before),Math.min(html.length,i+after));}
function attrs(fragment){return [...fragment.matchAll(/<a\b([^>]*)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi)].map(m=>({href:m[2],text:clean(m[4]),attrs:`${m[1]} ${m[3]}`.replace(/\s+/g,' ').trim()})).slice(0,80)}
function productImages(html,base){const vals=[];for(const m of html.matchAll(/(?:src|data-src|data-original|data-src2|content)=["']([^"']+)["']/gi))vals.push(m[1]);for(const m of html.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'\\\s<>]*)?/gi))vals.push(m[0].replace(/\\\//g,'/'));return [...new Set(vals.map(v=>abs(v,base)).filter(u=>/autoimg\.cn\/(?:@img\/)?car\d?\/cardfs\/product\//i.test(u)))];}
function links(html,base){return [...new Set([...html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].map(m=>abs(m[1],base)).filter(Boolean))];}
const list=await get(LIST);
const out={generatedAt:new Date().toISOString(),list:{status:list.r.status,bytes:list.bytes},specs:[]};
for(const id of IDS){
 const marker=`/spec/${id}/`;
 const raw=around(list.body,marker);
 const spec=await get(`https://www.autohome.com.cn/spec/${id}/`,LIST);
 const specTitle=clean(spec.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'');
 const imgs=productImages(spec.body,spec.r.url);
 const allLinks=links(spec.body,spec.r.url);
 out.specs.push({id,list:{rawSnippet:raw,plainSnippet:clean(raw),anchors:attrs(raw),priceTokens:[...clean(raw).matchAll(/([0-9]+(?:\.[0-9]+)?)\s*万/g)].map(m=>m[1]).slice(0,20)},spec:{status:spec.r.status,bytes:spec.bytes,title:specTitle,productImageCount:imgs.length,productImages:imgs.slice(0,40),picLinks:allLinks.filter(u=>/car\.autohome\.com\.cn\/pic\//i.test(u)).slice(0,80),specLinks:allLinks.filter(u=>new RegExp(`/spec/${id}(?:/|\\?|#|$)`).test(u)).slice(0,30)}})
}
await fs.writeFile('autohome-new-contract-probe.json',JSON.stringify(out,null,2));
console.log(JSON.stringify({generatedAt:out.generatedAt,specs:out.specs.map(s=>({id:s.id,list:{plainSnippet:s.list.plainSnippet.slice(0,3500),priceTokens:s.list.priceTokens,anchors:s.list.anchors.filter(a=>a.href.includes(`/spec/${s.id}/`)||/图片|配置|报价|询价/.test(a.text)).slice(0,30)},spec:{status:s.spec.status,title:s.spec.title,productImageCount:s.spec.productImageCount,productImages:s.spec.productImages.slice(0,12),picLinks:s.spec.picLinks.slice(0,20)}}))},null,2));
