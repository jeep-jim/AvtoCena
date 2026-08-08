import fs from 'node:fs/promises';
const URL='https://prestigemotorsport.com.au/auction-vehicle-display/?car_id=oWw3Q9WWIb1hfR';
const H={'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36','accept-language':'en-US,en;q=0.9',accept:'text/html,application/xhtml+xml,*/*;q=0.8'};
function abs(v){try{return new URL(String(v).replace(/&amp;/g,'&'),URL).toString()}catch{return''}}
function clean(v){return String(v??'').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()}
const r=await fetch(URL,{headers:{...H,referer:'https://prestigemotorsport.com.au/auctions/'},redirect:'follow',signal:AbortSignal.timeout(30000)});const html=await r.text();
const imgTags=[...html.matchAll(/<img\b[^>]*>/gi)].map(m=>m[0]);
const attrUrls=[];for(const tag of imgTags){for(const key of ['src','data-src','data-original','data-lazy-src','data-large','href']){const v=tag.match(new RegExp(`${key}\\s*=\\s*["']([^"']+)["']`,'i'))?.[1];if(v)attrUrls.push({key,url:abs(v),tag})}}
const cssUrls=[...html.matchAll(/url\((?:["']?)([^)'"\s]+)(?:["']?)\)/gi)].map(m=>abs(m[1]));
const literalUrls=[...html.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'\\\s<>]*)?/gi)].map(m=>abs(m[0].replace(/\\\//g,'/')));
const all=[...new Set([...attrUrls.map(x=>x.url),...cssUrls,...literalUrls].filter(Boolean))];
const imageLike=all.filter(u=>/\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(u));
const hosts={};for(const u of imageLike){try{const h=new URL(u).host;hosts[h]=(hosts[h]||0)+1}catch{}}
function contexts(term){const out=[];const low=html.toLowerCase();let at=0;while(out.length<8){const i=low.indexOf(term.toLowerCase(),at);if(i<0)break;out.push(html.slice(Math.max(0,i-900),Math.min(html.length,i+1800)));at=i+term.length}return out}
const text=clean(html);
const output={generatedAt:new Date().toISOString(),status:r.status,finalUrl:r.url,bytes:html.length,title:clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||''),imgTagCount:imgTags.length,hostCounts:hosts,imageLike:imageLike.slice(0,180),imgTags:imgTags.slice(0,120),contexts:{finalPrice:contexts('Final Price'),currentStatus:contexts('Current Status'),startPrice:contexts('Start Price'),chassis:contexts('Chassis'),location:contexts('Location')},plain:text.slice(0,18000)};
await fs.writeFile('prestige-japan-detail-anatomy-probe.json',JSON.stringify(output,null,2));
console.log(JSON.stringify({status:output.status,bytes:output.bytes,title:output.title,imgTagCount:output.imgTagCount,hostCounts:output.hostCounts,imageLike:output.imageLike.slice(0,80),plain:output.plain.slice(0,7000)},null,2));
