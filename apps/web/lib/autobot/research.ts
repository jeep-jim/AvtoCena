import {regSearch} from './provider';
import {readSource} from '../autocalc/source';

type Identity={make:string;model:string;year?:number;market?:string;trim?:string;topic?:string;motorCodes?:string;engine?:'google'|'bing';fresh?:boolean};
type Page={title:string;url:string;kind:'manufacturer'|'reference'|'document'|'web';text:string};
const manufacturerDomains:Record<string,string[]>={hyundai:['hyundai.com','hyundainews.com','hyundai.news'],kia:['kia.com','kiamedia.com'],toyota:['toyota.com','toyota.jp','toyota.co.jp','toyota-europe.com'],lexus:['lexus.com','lexus.jp','lexus.eu'],nissan:['nissan-global.com','nissan.co.jp','nissanusa.com'],honda:['honda.co.jp','global.honda','hondanews.com'],mazda:['mazda.com','mazda.co.jp','newsroom.mazda.com'],subaru:['subaru.jp','subaru.com'],mitsubishi:['mitsubishi-motors.com','mitsubishi-motors.co.jp'],suzuki:['globalsuzuki.com','suzuki.co.jp'],bmw:['bmw.com','bmwgroup.com'],mercedesbenz:['mercedes-benz.com','mercedes-benz-media.co.uk'],volkswagen:['volkswagen.com','volkswagen-newsroom.com'],audi:['audi.com','audi-mediacenter.com','audi.co.kr','audi.co.uk','audi.de'],volvo:['volvocars.com'],ford:['ford.com'],tesla:['tesla.com'],byd:['byd.com'],geely:['geely.com'],zeekr:['zeekrglobal.com','zeekrlife.com'],renault:['renault.com','renaultgroup.com'],chevrolet:['chevrolet.com','gm.com'],genesis:['genesis.com']};
const token=(s:string)=>s.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const clean=(s:unknown)=>String(s||'').replace(/[<>\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().slice(0,100);
export function manufacturerLink(value:string,make:string){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.search&&!/\.(pdf|zip|jpg|png)$/i.test(u.pathname)&&(manufacturerDomains[token(make)]||[]).some(h=>u.hostname===h||u.hostname.endsWith('.'+h));}catch{return false;}}
export function manufacturerDocument(value:string,make:string){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&/\.pdf$/i.test(u.pathname)&&(manufacturerDomains[token(make)]||[]).some(h=>u.hostname===h||u.hostname.endsWith('.'+h));}catch{return false;}}
export function mentionsModel(text:string,model:string){const words=(s:string)=>s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').replace(/step\s*(?:wagon|wgn)/g,'stepwgn').trim();return (' '+words(text)+' ').includes(' '+words(model)+' ');}
export function researchText(html:string){return html.replace(/<(script|style|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<!--[\s\S]*?-->/g,' ').replace(/<\/(?:tr|p|div|h[1-6]|li)>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/&#(\d+);/g,(_,n)=>Number(n)<0x110000?String.fromCodePoint(Number(n)):' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n').trim();}
export function researchTopic(question:string){
 if(/(?:30|тридцат).{0,18}(?:мин|мощ)|30-minute/i.test(question))return '30-minute';
 if(/расход|потребл|экономич|consumption|economy|WLTP|WLTC|JC08|л\s*\/\s*100|км\s*\/\s*л/i.test(question))return 'consumption';
 if(/клиренс|габарит|размер|длин[аыу]|ширин|высот|багажник|мест|масса|вес|dimensions|clearance/i.test(question))return 'dimensions';
 if(/разгон|скорост|динамик|acceleration|speed/i.test(question))return 'performance';
 return 'specifications';
}
export function researchNeeded(question:string,car:any){return Boolean(car&&(researchTopic(question)!=='specifications'||/(мощ|квт|л\.\s?с|двигател|топлив|привод|объ[её]м|характерист|параметр|найди|найти|интернет|гугл|google|поищи|не\s*заполн|30.?мин|power|specification)/i.test(question)));}
const cache=new Map<string,{until:number;result:any}>();
/** Read-only, on-demand discovery. Queries contain model identity only, never VINs or chat history. */
export async function researchVehicle(identity:Identity,signal:AbortSignal,read=readSource){
 const make=clean(identity.make),model=clean(identity.model);if(!make||!model)return {status:'unknown_identity',pages:[]};
 const key=JSON.stringify([make,model,identity.year,identity.market,identity.trim,identity.topic,identity.motorCodes,identity.engine]);const hit=cache.get(key);if(!identity.fresh&&read===readSource&&hit&&hit.until>Date.now())return hit.result;
 const pages:Page[]=[],failures:string[]=[];const budget=AbortSignal.any([signal,AbortSignal.timeout(40000)]);
 const nativeTask=()=>read===readSource?regSearch([{role:'system',content:'Найди характеристики автомобиля в интернете. Отвечай по-русски кратко с источниками. Добавь полные URL найденных источников прямо в текст обычными ссылками Markdown [название](https://...). Одних номеров [1] недостаточно. Не выдумывай URL. Учитывай год, рынок и комплектацию. Предпочитай документы производителя. Если версии различаются, перечисли различия. Не подменяй 30-минутную мощность пиковой. Не выдумывай найденные данные.'},{role:'user',content:JSON.stringify({make,model,year:identity.year,market:identity.market,trim:identity.trim,topic:identity.topic,motorCodes:identity.motorCodes})}],AbortSignal.any([signal,AbortSignal.timeout(30000)])).catch(()=>null):Promise.resolve(null);
 const catalogTask=discoverManufacturerCatalog(identity,budget,read).catch(()=>({pages:[],failures:['Каталог производителя недоступен.']}));
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
   const score=(u:string)=>{const topicScore=(/spec|technical|data.?sheet/i.test(u)?60:/drive-system|engine|powertrain|performance/i.test(u)?35:0)-(/production|sales|market-launch/i.test(u)?30:0)+(/coupe/i.test(identity.trim||'')&&/coupe/i.test(u)?15:0);const years=u.match(/(?:19|20)\d{2}/g)?.map(Number)||[];return topicScore+(years.includes(identity.year)?20:years.some(y=>y<=(identity.year||0))?8:0)+(/spec|technical/i.test(u)?5:/performance|powertrain/i.test(u)?4:0);};
   const ranked=(data.parse?.externallinks||[]).filter((u:any)=>typeof u==='string'&&(manufacturerLink(u,make)||manufacturerDocument(u,make))).sort((a:string,b:string)=>score(b)-score(a));const links:string[]=[];const hosts=new Set<string>();for(const url of ranked){const host=new URL(url).hostname.replace(/^www\./,'');if(!hosts.has(host)){hosts.add(host);links.push(url);}if(links.length===3)break;}for(const url of ranked){if(links.length>=3)break;if(!links.includes(url))links.push(url);}
   const fetched=await Promise.allSettled(links.map(async(url:string)=>{const p=await read(url,AbortSignal.any([budget,AbortSignal.timeout(8000)]),0,manufacturerDocument(url,make)?'document':'html');if(!manufacturerLink(p.url,make)&&!manufacturerDocument(p.url,make))throw Error('redirect');const text=researchText(p.html);if(/access denied|verify you are human|just a moment|captcha/i.test(text.slice(0,1200)))throw Error('blocked');if(!mentionsModel(text,model))throw Error('wrong model');return {title:make+' — '+(p.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]*>/g,'').slice(0,160)||model),url:p.url,kind:manufacturerDocument(p.url,make)?'document' as const:'manufacturer' as const,text:evidenceExcerpt(text)};}));
   for(const result of fetched)if(result.status==='fulfilled')pages.push(result.value);else failures.push('Страница производителя не предоставила доступные данные.');
  }
 }catch{failures.push('Внешний источник сейчас недоступен.');}
 const discovery=await discoveryTask;
 for(const p of discovery.pages.reverse())if(!pages.some(x=>x.url===p.url))pages.unshift(p);failures.push(...discovery.failures);
 const catalog=await catalogTask;for(const p of [...catalog.pages].reverse())if(!pages.some(x=>x.url===p.url))pages.unshift(p);failures.push(...catalog.failures);
 const native=hasUsefulReadEvidence(identity.topic,pages)?null:await nativeTask();
 const nativeSources=[...(native?.sources||[])];
 if(native&&!nativeSources.length){
  const verified=await Promise.allSettled((native.linkCandidates||[]).slice(0,3).map(async(link:any)=>{
   const page=await read(link.url,AbortSignal.any([signal,AbortSignal.timeout(8000)]),0,/\.pdf(?:$|\?)/i.test(link.url)?'document':'html');
   const text=researchText(page.html);
   if(/access denied|verify you are human|just a moment|captcha/i.test(text.slice(0,1200))||!mentionsModel(text,model))throw Error('unverified_link');
   return {title:link.title,url:page.url,kind:'web' as const,text:evidenceExcerpt(text)};
  }));
  for(const item of verified)if(item.status==='fulfilled'){
   if(!pages.some(p=>p.url===item.value.url))pages.push(item.value);
   nativeSources.push({title:item.value.title,url:item.value.url});
  }
 }
 const searchEvidence=nativeSources.length?{answer:native!.text,sources:nativeSources}:undefined;
 const generalReference=native&&!searchEvidence?{answer:native.text.replace(/\[[^\]]*\]\([^)]*\)|\[\d+\]/g,''),verified:false,note:'Справочная подсказка модели. Источники не подтверждены; не называй это проверенными данными или результатом чтения сайта.'}:undefined;
 const result={searchEvidence,generalReference,webSearch:{manufacturerReadPages:catalog.pages.length,engine:discovery.engine||identity.engine||'bing',readPages:discovery.pages.length,failures:discovery.failures,links:researchQueries(identity).map(q=>({title:'Поиск '+(identity.engine==='google'?'Google':'Bing'),url:(identity.engine==='google'?'https://www.google.com/search?':'https://www.bing.com/search?')+new URLSearchParams({q})}))},identity:{make,model,year:identity.year,market:identity.market,trim:identity.trim},checkedAt:new Date().toISOString(),status:pages.length||searchEvidence?'found':'not_found',pages,failures,scope:'Поиск по ограниченному набору запросов в выбранном поисковике, чтение найденных публичных страниц/PDF и справочных ссылок производителя. Непрочитанные документы не подтверждают параметры. Данные справочные; применимость к году, поколению, рынку и комплектации нужно проверять. Не считать максимальную мощность 30-минутной. Не менять карточку или расчёт.'};
 if(read===readSource&&(pages.length||searchEvidence)){if(cache.size>=100)cache.delete(cache.keys().next().value);cache.set(key,{until:Date.now()+(pages.some(p=>p.kind!=='reference')?30*60000:60000),result});}return result;
}

export function webResults(xml:string){
 return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0,8).flatMap(m=>{
 const field=(name:string)=>researchText((m[1].match(new RegExp('<'+name+'>([\\s\\S]*?)</'+name+'>'))?.[1]||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1'));
 const url=field('link');try{const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password)return [];}catch{return [];}
 return [{url,title:field('title'),snippet:field('description')}];
 });
}
export function evidenceExcerpt(text:string){
 const lines=text.split(/\n|(?<=[.;])\s+/);const relevant=lines.flatMap((l,i)=>/30.?min|30.?мин|тридцат|maximum continuous|номинальн|длительн|power|мощност|kW|кВт|двигател|motor|engine|consumption|economy|WLTC|WLTP|JC08|km\/l|l\/100|расход|потребл|燃費|dimensions|clearance|клиренс|багажник|разгон/i.test(l)?[l.slice(0,1200),...(i>0?[lines[i-1].slice(-240)]:[]),...(i+1<lines.length?[lines[i+1].slice(0,240)]:[])]:[]);
 return ([...new Set(relevant)].join('\n')+'\n'+text.slice(0,1500)).slice(0,6500);
}

export function variantEvidence(text:string,trim?:string){
 const variant=trim?.match(/\b(\d{2})\s*(TFSI|TDI)\b/i);
 if(!variant)return evidenceExcerpt(text);
 const re=new RegExp('\\b'+variant[1]+'\\s*'+variant[2]+'\\b','gi');
 const lines=[...text.matchAll(re)].flatMap(match=>{
  let fragment=text.slice(match.index,match.index+220);const next=fragment.slice(match[0].length).search(/\b\d{2}\s*(?:TFSI|TDI)\b/i);if(next>=0)fragment=fragment.slice(0,match[0].length+next);
  return /\d[\d., ]*\s*(?:kW|кВт|hp|PS)(?![\p{L}])/iu.test(fragment)?[fragment.replace(/\s+/g,' ')]:[];
 });
 return (lines.join('\n').slice(0,2800)+'\n'+evidenceExcerpt(text)).slice(0,6500);
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
 const family='"'+[clean(identity.make),clean(identity.model)].filter(Boolean).join(' ').replace(/"/g,'')+'"';
 const market=({korea:'Korea',china:'China',japan:'Japan',uae:'UAE',europe:'Europe'} as Record<string,string>)[identity.market||''];
 const base=[family,identity.year,market,clean(identity.trim),clean(identity.motorCodes)].filter(Boolean).join(' ');
 if(identity.topic==='consumption')return [base+' fuel consumption WLTC WLTP km/L L/100km',base+(identity.market==='japan'?' 燃費 WLTC カタログ':' расход топлива цикл')];
 if(identity.topic==='dimensions')return [base+' dimensions ground clearance boot capacity',base+' размеры клиренс багажник'];
 if(identity.topic==='performance')return [base+' acceleration top speed specifications',base+' разгон максимальная скорость'];
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
  return Number(manufacturerLink(r.url,identity.make)||manufacturerDocument(r.url,identity.make))*10+Number(text.includes(token(identity.model)))*5+Number(text.includes(token(identity.make)))*3+Number(Boolean(identity.year)&&text.includes(String(identity.year)))*2;
 };
 const ranked=unique.sort((a,b)=>identityScore(b)-identityScore(a));
 const fetched=await Promise.allSettled(ranked.slice(0,5).map(async r=>{
  const page=await read(r.url,AbortSignal.any([signal,AbortSignal.timeout(10000)]),0,'document');const text=researchText(page.html);
  if(/access denied|verify you are human|just a moment|captcha/i.test(text.slice(0,1000)))throw Error('blocked');
  if(!mentionsModel(text,identity.model))throw Error('model not found');
  if(!mentionsModel(r.title+' '+page.url,identity.model)&&!text.split(/\n/).some(line=>mentionsModel(line,identity.model)&&/\d[\d., ]*\s*(?:kW|кВт|hp|PS|л\.\s?с)|specification|техническ/i.test(line)))throw Error('generic brand page');
  return {title:r.title,url:page.url,kind:manufacturerLink(page.url,identity.make)?'manufacturer' as const:/\.pdf(?:[?#]|$)/i.test(page.url)?'document' as const:'web' as const,text:evidenceExcerpt(text)};
 }));
 for(const r of fetched)if(r.status==='fulfilled')pages.push(r.value);else failures.push('Одна из найденных страниц не прочитана или не содержит указанную модель.');
 return {pages,failures,engine:usedEngine};
}


/** Follow observed official catalog links only: two indexes and at most three model/document pages. */
export async function discoverManufacturerCatalog(identity:Identity,signal:AbortSignal,read=readSource){
 const starts:Record<string,string[]>={audi:['https://www.audi.com/en/models-4','https://www.audi.com/en/previous-models-78']};
 const seeds=starts[token(identity.make)];if(!seeds)return {pages:[] as Page[],failures:[] as string[]};
 const pages:Page[]=[],failures:string[]=[],visited=new Set(seeds);
 const decode=(s:string)=>{try{return decodeURIComponent(s);}catch{return s;}};
 const links=(html:string,base:string)=>[...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].flatMap(m=>{
  try{const url=new URL(m[1].replace(/&amp;/g,'&'),base).href;if(!manufacturerLink(url,identity.make)&&!manufacturerDocument(url,identity.make))return [];const title=researchText(m[2]);if(!mentionsModel(title+' '+decode(url),identity.model))return [];return [{url,title}];}catch{return [];}
 });
 const readOfficial=async(url:string)=>{const p=await read(url,AbortSignal.any([signal,AbortSignal.timeout(8000)]),0,manufacturerDocument(url,identity.make)?'document':'html');if(!manufacturerLink(p.url,identity.make)&&!manufacturerDocument(p.url,identity.make))throw Error('redirect');if(/access denied|verify you are human|just a moment|captcha/i.test(researchText(p.html).slice(0,1000)))throw Error('blocked');return p;};
 const initial=await Promise.allSettled(seeds.map(readOfficial));let candidates:Array<{url:string;title:string}>=[];
 for(const r of initial)if(r.status==='fulfilled')candidates.push(...links(r.value.html,r.value.url));else failures.push('Один из каталогов производителя недоступен.');
 const terms:string[]=clean(identity.trim).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[a-z]+|\d+/g)||[];
 const score=(p:{url:string;title:string})=>{const text=(p.title+' '+decode(p.url)).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase(),until=text.match(/until[\s-]*(20\d{2})/);if(until&&identity.year&&Number(until[1])<identity.year)return -1000;return (until&&identity.year?20:0)+terms.reduce((n,t)=>n+(mentionsModel(text,t)?10:0),0)+(manufacturerDocument(p.url,identity.make)?30:0)+(/technical|specification|data.sheet/.test(text)?15:0)-(/image|picture|video|gallery|album/.test(text)?100:0);};
 for(let depth=0;depth<3&&!signal.aborted;depth++){
  const next=[...new Map(candidates.map(p=>[p.url,p])).values()].filter(p=>!visited.has(p.url)&&score(p)>-100).sort((a,b)=>score(b)-score(a))[0];if(!next)break;visited.add(next.url);
  try{const p=await readOfficial(next.url),text=researchText(p.html);if(!mentionsModel(text,identity.model))continue;
   const document=manufacturerDocument(p.url,identity.make);const title=document?decode(new URL(p.url).pathname.split('/').pop()||next.title).replace(/[_-]/g,' ').slice(0,160):researchText(p.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||next.title);
   pages.unshift({title,url:p.url,kind:document?'document':'manufacturer',text:((document?text.slice(0,600)+'\n':'')+variantEvidence(text,identity.trim)).slice(0,6500)});
   if(document)break;candidates.push(...links(p.html,p.url));
  }catch{failures.push('Одна из технических страниц производителя недоступна.');}
 }
 return {pages,failures};
}

/** Paid discovery is a fallback when readable non-encyclopedic sources lack the requested topic. */
export function hasUsefulReadEvidence(topic:string|undefined,pages:Array<{kind:string;text:string}>){
 const markers=topic==='consumption'?/\d[\d.,]*\s*(?:km\s*\/\s*l|l\s*\/\s*100\s*km|mpg|км\s*\/\s*л|л\s*\/\s*100|кВт.?ч\s*\/\s*100)|(?:WLTC|WLTP|JC08|燃費|расход|consumption).{0,100}\d/iu
 :topic==='dimensions'?/(?:clearance|dimensions|клиренс|багажник|ширина|длина|height|width|length).{0,80}\d/iu
 :topic==='performance'?/(?:acceleration|top speed|разгон|максимальная скорость).{0,80}\d/iu
 :topic==='30-minute'?/(?:30.?min|30.?мин|тридцат).{0,80}\d[\d., ]*\s*(?:kW|кВт)/iu
 :/\d[\d., ]*\s*(?:kW|кВт|hp|PS|л\.\s?с)(?![\p{L}])/iu;
 return pages.some(p=>p.kind!=='reference'&&markers.test(p.text));
}
