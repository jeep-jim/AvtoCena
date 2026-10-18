import {readSource} from '../autocalc/source';

type Identity={make:string;model:string;year?:number;market?:string;trim?:string;topic?:string;motorCodes?:string;engine?:'google'|'bing';fresh?:boolean};
type Page={title:string;url:string;kind:'manufacturer'|'reference'|'document'|'web';text:string};
const manufacturerDomains:Record<string,string[]>={hyundai:['hyundai.com','hyundainews.com','hyundai.news'],kia:['kia.com','kiamedia.com'],toyota:['toyota.com','toyota.jp','toyota.co.jp','toyota-europe.com'],lexus:['lexus.com','lexus.jp','lexus.eu'],nissan:['nissan-global.com','nissan.co.jp','nissanusa.com'],honda:['honda.co.jp','global.honda','hondanews.com'],mazda:['mazda.com','mazda.co.jp','newsroom.mazda.com'],subaru:['subaru.jp','subaru.com'],mitsubishi:['mitsubishi-motors.com','mitsubishi-motors.co.jp'],suzuki:['globalsuzuki.com','suzuki.co.jp'],bmw:['bmw.com','bmwgroup.com'],mercedesbenz:['mercedes-benz.com','mercedes-benz-media.co.uk'],volkswagen:['volkswagen.com','volkswagen-newsroom.com'],audi:['audi.com','audi-mediacenter.com','audi.co.kr','audi.co.uk','audi.de'],volvo:['volvocars.com'],ford:['ford.com'],tesla:['tesla.com'],byd:['byd.com'],geely:['geely.com'],zeekr:['zeekrglobal.com','zeekrlife.com'],renault:['renault.com','renaultgroup.com'],chevrolet:['chevrolet.com','gm.com'],genesis:['genesis.com']};
const token=(s:string)=>s.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const clean=(s:unknown)=>String(s||'').replace(/[<>\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().slice(0,100);
export function manufacturerLink(value:string,make:string){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.search&&!/\.(pdf|zip|jpg|png)$/i.test(u.pathname)&&(manufacturerDomains[token(make)]||[]).some(h=>u.hostname===h||u.hostname.endsWith('.'+h));}catch{return false;}}
export function researchText(html:string){return html.replace(/<(script|style|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<!--[\s\S]*?-->/g,' ').replace(/<\/(?:tr|p|div|h[1-6]|li)>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/&#(\d+);/g,(_,n)=>Number(n)<0x110000?String.fromCodePoint(Number(n)):' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n').trim();}
export function researchNeeded(question:string,car:any){return Boolean(car&&/(мощ|квт|л\.\s?с|двигател|топлив|привод|объ[её]м|характерист|параметр|найди|найти|интернет|гугл|google|поищи|не\s*заполн|30.?мин|power|specification)/i.test(question));}
const cache=new Map<string,{until:number;result:any}>();
/** Read-only, on-demand discovery. Queries contain model identity only, never VINs or chat history. */
export async function researchVehicle(identity:Identity,signal:AbortSignal,read=readSource){
 const make=clean(identity.make),model=clean(identity.model);if(!make||!model)return {status:'unknown_identity',pages:[]};
 const key=JSON.stringify([make,model,identity.year,identity.market,identity.trim,identity.topic,identity.motorCodes,identity.engine]);const hit=cache.get(key);if(!identity.fresh&&read===readSource&&hit&&hit.until>Date.now())return hit.result;
 const pages:Page[]=[],failures:string[]=[];const budget=AbortSignal.any([signal,AbortSignal.timeout(40000)]);
 const discoveryTask=discoverVehicleWeb(identity,budget,read).catch(()=>({pages:[],failures:['Веб-поиск не завершён.'],engine:identity.engine||'bing'}));
 try{
  const query=new URLSearchParams({action:'query',generator:'search',gsrsearch:make+' '+model,gsrlimit:'2',prop:'info',inprop:'url',format:'json'});
  const search=JSON.parse((await read('https://en.wikipedia.org/w/api.php?'+query,budget,0,'json')).html);
  const candidates=Object.values(search.query?.pages||{}) as any[];
  const page=candidates.find(p=>token(p.title).includes(token(model))&&token(p.title).includes(token(make)))||candidates.find(p=>token(p.title)===token(model));
  if(page&&Number.isInteger(page.pageid)){
   const data=JSON.parse((await read('https://en.wikipedia.org/w/api.php?'+new URLSearchParams({action:'parse',pageid:String(page.pageid),prop:'text|externallinks',format:'json'}),budget,0,'json')).html);
   const article=researchText(data.parse?.text?.['*']||'');
   if(article)pages.push({title:page.title+' — Wikipedia',url:'https://en.wikipedia.org/wiki/'+encodeURIComponent(page.title.replace(/ /g,'_')),kind:'reference',text:article.slice(0,12000)});
   const score=(u:string)=>{const years=u.match(/(?:19|20)\d{2}/g)?.map(Number)||[];return (years.includes(identity.year)?20:years.some(y=>y<=(identity.year||0))?8:0)+(/spec|technical/i.test(u)?5:/performance|powertrain/i.test(u)?4:0);};
   const ranked=(data.parse?.externallinks||[]).filter((u:any)=>typeof u==='string'&&manufacturerLink(u,make)).sort((a:string,b:string)=>score(b)-score(a));const links:string[]=[];const hosts=new Set<string>();for(const url of ranked){const host=new URL(url).hostname.replace(/^www\./,'');if(!hosts.has(host)){hosts.add(host);links.push(url);}if(links.length===3)break;}for(const url of ranked){if(links.length>=3)break;if(!links.includes(url))links.push(url);}
   const fetched=await Promise.allSettled(links.map(async(url:string)=>{const p=await read(url,AbortSignal.any([budget,AbortSignal.timeout(8000)]));if(!manufacturerLink(p.url,make))throw Error('redirect');const text=researchText(p.html);if(/access denied|verify you are human|just a moment|captcha/i.test(text.slice(0,1200)))throw Error('blocked');if(!token(text).includes(token(model)))throw Error('wrong model');return {title:make+' — '+(p.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]*>/g,'').slice(0,160)||model),url:p.url,kind:'manufacturer' as const,text:text.slice(0,8000)};}));
   for(const result of fetched)if(result.status==='fulfilled')pages.push(result.value);else failures.push('Страница производителя не предоставила доступные данные.');
  }
 }catch{failures.push('Внешний источник сейчас недоступен.');}
 const discovery=await discoveryTask;
 for(const p of discovery.pages.reverse())if(!pages.some(x=>x.url===p.url))pages.unshift(p);failures.push(...discovery.failures);
 const result={webSearch:{engine:discovery.engine||identity.engine||'bing',readPages:discovery.pages.length,failures:discovery.failures,links:researchQueries(identity).map(q=>({title:'Поиск '+(identity.engine==='google'?'Google':'Bing'),url:(identity.engine==='google'?'https://www.google.com/search?':'https://www.bing.com/search?')+new URLSearchParams({q})}))},identity:{make,model,year:identity.year,market:identity.market,trim:identity.trim},checkedAt:new Date().toISOString(),status:pages.length?'found':'not_found',pages,failures,scope:'Поиск по ограниченному набору запросов в выбранном поисковике, чтение найденных публичных страниц/PDF и справочных ссылок производителя. Непрочитанные документы не подтверждают параметры. Данные справочные; применимость к году, поколению, рынку и комплектации нужно проверять. Не считать максимальную мощность 30-минутной. Не менять карточку или расчёт.'};
 if(read===readSource&&pages.length){if(cache.size>=100)cache.delete(cache.keys().next().value);cache.set(key,{until:Date.now()+(pages.some(p=>p.kind!=='reference')?30*60000:60000),result});}return result;
}

export function webResults(xml:string){
 return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0,8).flatMap(m=>{
 const field=(name:string)=>researchText((m[1].match(new RegExp('<'+name+'>([\\s\\S]*?)</'+name+'>'))?.[1]||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1'));
 const url=field('link');try{const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password)return [];}catch{return [];}
 return [{url,title:field('title'),snippet:field('description')}];
 });
}
export function evidenceExcerpt(text:string){
 const lines=text.split(/\n|(?<=[.;])\s+/);const relevant=lines.flatMap((l,i)=>/30.?min|30.?мин|тридцат|maximum continuous|номинальн|длительн|power|мощност|kW|кВт|двигател|motor|engine/i.test(l)?lines.slice(Math.max(0,i-1),i+2):[]);
 return ([...new Set(relevant)].join('\n')+'\n'+text.slice(0,1500)).slice(0,6500);
}
export function googleResults(html:string){
 const rows:Array<{url:string;title:string;snippet:string}>=[];
 for(const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
  if(!/<h3\b/i.test(match[2]))continue;
  try{const link=new URL(match[1].replace(/&amp;/g,'&'),'https://www.google.com');const raw=link.pathname==='/url'?(link.searchParams.get('q')||link.searchParams.get('url')):link.href;if(!raw)continue;const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||/(^|\.)google\.[a-z.]+$/.test(u.hostname))continue;
   rows.push({url:u.href,title:researchText(match[2]),snippet:''});
  }catch{}
 }
 return [...new Map(rows.map(r=>[r.url,r])).values()].slice(0,8);
}
export function researchQueries(identity:Identity){
 const family=[clean(identity.make),clean(identity.model)].filter(Boolean).join(' ');
 const market=({korea:'Korea',china:'China',japan:'Japan',uae:'UAE',europe:'Europe'} as Record<string,string>)[identity.market||''];
 const base=[family,identity.year,market,clean(identity.trim),clean(identity.motorCodes)].filter(Boolean).join(' ');
 return identity.topic==='30-minute'?[base+' 30 minute power UNECE R85 certificate',family+' 30 минутная мощность ОТТС']:[base+' technical specifications',family+' '+(identity.year||'')+' характеристики мощность'];
}
export async function discoverVehicleWeb(identity:Identity,signal:AbortSignal,read=readSource){
 const queries=researchQueries(identity),engine=identity.engine||'bing';
 const pages:Page[]=[],failures:string[]=[];
 const searches=await Promise.allSettled(queries.map(async q=>{
  const url=engine==='google'?'https://www.google.com/search?'+new URLSearchParams({q,hl:'en',num:'8'}):'https://www.bing.com/search?'+new URLSearchParams({format:'rss',q});
  const result=await read(url,AbortSignal.any([signal,AbortSignal.timeout(8000)]),0,engine==='google'?'html':'xml');
  if(/captcha|verify you are human|unusual traffic/i.test(result.html.slice(0,1500)))throw Error('search blocked');
  return engine==='google'?googleResults(result.html):webResults(result.html);
 }));
 let results=searches.flatMap(r=>r.status==='fulfilled'?r.value:[]);
 let usedEngine:string=engine;
 // A separate public search provider is not a retry through a proxy or another identity.
 // Keep the failure visible and never treat an unread search snippet as evidence.
 if(!results.length&&!signal.aborted){
  const alternate=engine==='google'?'bing':'google';
  failures.push('Поиск '+engine+' не дал читаемых ссылок; выполнен один запрос к '+alternate+'.');
  usedEngine=engine+' + '+alternate;
  try{const url=alternate==='google'?'https://www.google.com/search?'+new URLSearchParams({q:queries[1],hl:'en',num:'8'}):'https://www.bing.com/search?'+new URLSearchParams({format:'rss',q:queries[1]});const found=await read(url,AbortSignal.any([signal,AbortSignal.timeout(8000)]),0,alternate==='google'?'html':'xml');if(!/captcha|verify you are human|unusual traffic/i.test(found.html.slice(0,1500)))results=alternate==='google'?googleResults(found.html):webResults(found.html);}catch{failures.push('Дополнительный поисковый запрос недоступен.');}
 }
 if(!results.length)failures.push('Поисковая система '+engine+' не вернула читаемых ссылок. Это не доказывает отсутствия сведений.');
 if(searches.some(r=>r.status==='rejected'))failures.push('Один из запросов к '+engine+' недоступен.');
 const unique=[...new Map(results.map(r=>[r.url,r])).values()];
 const identityScore=(r:{title:string;snippet:string;url:string})=>{
  const text=token(r.title+' '+r.snippet+' '+r.url);
  return Number(manufacturerLink(r.url,identity.make))*10+Number(text.includes(token(identity.model)))*5+Number(text.includes(token(identity.make)))*3+Number(Boolean(identity.year)&&text.includes(String(identity.year)))*2;
 };
 const ranked=unique.sort((a,b)=>identityScore(b)-identityScore(a));
 const fetched=await Promise.allSettled(ranked.slice(0,5).map(async r=>{
  const page=await read(r.url,AbortSignal.any([signal,AbortSignal.timeout(10000)]),0,'document');const text=researchText(page.html);
  if(/access denied|verify you are human|just a moment|captcha/i.test(text.slice(0,1000)))throw Error('blocked');
  if(!token(text).includes(token(identity.model)))throw Error('model not found');
  return {title:r.title,url:page.url,kind:manufacturerLink(page.url,identity.make)?'manufacturer' as const:/\.pdf(?:[?#]|$)/i.test(page.url)?'document' as const:'web' as const,text:evidenceExcerpt(text)};
 }));
 for(const r of fetched)if(r.status==='fulfilled')pages.push(r.value);else failures.push('Одна из найденных страниц не прочитана или не содержит указанную модель.');
 return {pages,failures,engine:usedEngine};
}
