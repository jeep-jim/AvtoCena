import {readSource} from '../autocalc/source';

type Identity={make:string;model:string;year?:number;market?:string;trim?:string;topic?:string;motorCodes?:string};
type Page={title:string;url:string;kind:'manufacturer'|'reference'|'document'|'web';text:string};
const manufacturerDomains:Record<string,string[]>={hyundai:['hyundai.com','hyundainews.com','hyundai.news'],kia:['kia.com','kiamedia.com'],toyota:['toyota.com','toyota.jp','toyota.co.jp','toyota-europe.com'],lexus:['lexus.com','lexus.jp','lexus.eu'],nissan:['nissan-global.com','nissan.co.jp','nissanusa.com'],honda:['honda.co.jp','global.honda','hondanews.com'],mazda:['mazda.com','mazda.co.jp','newsroom.mazda.com'],subaru:['subaru.jp','subaru.com'],mitsubishi:['mitsubishi-motors.com','mitsubishi-motors.co.jp'],suzuki:['globalsuzuki.com','suzuki.co.jp'],bmw:['bmw.com','bmwgroup.com'],mercedesbenz:['mercedes-benz.com','mercedes-benz-media.co.uk'],volkswagen:['volkswagen.com','volkswagen-newsroom.com'],audi:['audi.com','audi-mediacenter.com'],volvo:['volvocars.com'],ford:['ford.com'],tesla:['tesla.com'],byd:['byd.com'],geely:['geely.com'],zeekr:['zeekrglobal.com','zeekrlife.com'],renault:['renault.com','renaultgroup.com'],chevrolet:['chevrolet.com','gm.com'],genesis:['genesis.com']};
const token=(s:string)=>s.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const clean=(s:unknown)=>String(s||'').replace(/[<>\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().slice(0,100);
export function manufacturerLink(value:string,make:string){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.search&&!/\.(pdf|zip|jpg|png)$/i.test(u.pathname)&&(manufacturerDomains[token(make)]||[]).some(h=>u.hostname===h||u.hostname.endsWith('.'+h));}catch{return false;}}
export function researchText(html:string){return html.replace(/<(script|style|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<!--[\s\S]*?-->/g,' ').replace(/<\/(?:tr|p|div|h[1-6]|li)>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/&#(\d+);/g,(_,n)=>Number(n)<0x110000?String.fromCodePoint(Number(n)):' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n').trim();}
export function researchNeeded(question:string,car:any){return Boolean(car&&/(мощ|квт|л\.\s?с|двигател|топлив|привод|объ[её]м|характерист|параметр|найди|найти|интернет|не\s*заполн|30.?мин|power|specification)/i.test(question));}
const cache=new Map<string,{until:number;result:any}>();
/** Read-only, on-demand discovery. Queries contain model identity only, never VINs or chat history. */
export async function researchVehicle(identity:Identity,signal:AbortSignal,read=readSource){
 const make=clean(identity.make),model=clean(identity.model);if(!make||!model)return {status:'unknown_identity',pages:[]};
 const key=JSON.stringify([make,model,identity.year,identity.market,identity.trim,identity.topic,identity.motorCodes]);const hit=cache.get(key);if(read===readSource&&hit&&hit.until>Date.now())return hit.result;
 const pages:Page[]=[],failures:string[]=[];const budget=AbortSignal.any([signal,AbortSignal.timeout(40000)]);
 const discoveryTask=discoverVehicleWeb(identity,budget,read).catch(()=>({pages:[],failures:['Веб-поиск не завершён.']}));
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
 const result={identity:{make,model,year:identity.year,market:identity.market,trim:identity.trim},checkedAt:new Date().toISOString(),status:pages.length?'found':'not_found',pages,failures,scope:'Поиск по двум запросам в Bing, чтение найденных публичных страниц/PDF и справочных ссылок производителя. Непрочитанные документы не подтверждают параметры. Данные справочные; применимость к году, поколению, рынку и комплектации нужно проверять. Не считать максимальную мощность 30-минутной. Не менять карточку или расчёт.'};
 if(read===readSource&&pages.length){if(cache.size>=100)cache.delete(cache.keys().next().value);cache.set(key,{until:Date.now()+6*3600000,result});}return result;
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
export async function discoverVehicleWeb(identity:Identity,signal:AbortSignal,read=readSource){
 const base=[clean(identity.make),clean(identity.model),identity.year,clean(identity.trim),clean(identity.motorCodes)].filter(Boolean).join(' ');
 const queries=identity.topic==='30-minute'?[base+' 30 minute power UNECE R85 certificate',base+' 30 минутная мощность ОТТС']:[base+' official technical specifications',base+' характеристики мощность'];
 const pages:Page[]=[],failures:string[]=[];
 const searches=await Promise.allSettled(queries.map(q=>read('https://www.bing.com/search?'+new URLSearchParams({format:'rss',q}),AbortSignal.any([signal,AbortSignal.timeout(8000)]),0,'xml')));
 const results=searches.flatMap(r=>r.status==='fulfilled'?webResults(r.value.html):[]);
 if(!results.length)failures.push('Поисковая система не вернула подходящих ссылок. Это не доказывает отсутствия документов.');
 if(searches.some(r=>r.status==='rejected'))failures.push('Один из поисковых запросов недоступен.');
 const unique=[...new Map(results.map(r=>[r.url,r])).values()];
 const ranked=unique.sort((a,b)=>Number(manufacturerLink(b.url,identity.make))-Number(manufacturerLink(a.url,identity.make)));
 const fetched=await Promise.allSettled(ranked.slice(0,5).map(async r=>{
  const page=await read(r.url,AbortSignal.any([signal,AbortSignal.timeout(10000)]),0,'document');const text=researchText(page.html);
  if(/access denied|verify you are human|just a moment|captcha/i.test(text.slice(0,1000)))throw Error('blocked');
  if(!token(text).includes(token(identity.model)))throw Error('model not found');
  return {title:r.title,url:page.url,kind:manufacturerLink(page.url,identity.make)?'manufacturer' as const:/\.pdf(?:[?#]|$)/i.test(page.url)?'document' as const:'web' as const,text:evidenceExcerpt(text)};
 }));
 for(const r of fetched)if(r.status==='fulfilled')pages.push(r.value);else failures.push('Одна из найденных страниц не прочитана или не содержит указанную модель.');
 return {pages,failures};
}
