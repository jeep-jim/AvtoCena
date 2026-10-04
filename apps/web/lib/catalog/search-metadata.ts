import type {Metadata} from 'next';
export const SEARCH_MARKETS:Record<string,string>={japan:'Японии',china:'Китая',korea:'Кореи',uae:'ОАЭ',europe:'Европы',georgia:'Грузии'};
type Params=Record<string,string|string[]|undefined>;
const first=(v?:string|string[])=>Array.isArray(v)?v[0]||'':v||'';
const clean=(v:string)=>v.replace(/[<>"\u0000-\u001f]/g,'').trim().slice(0,100);
export function catalogSearchMetadata(params:Params={}):Metadata{
 const market=first(params.market),country=Object.hasOwn(SEARCH_MARKETS,market)?SEARCH_MARKETS[market]:undefined;
 const make=clean(first(params.make)),model=clean(first(params.model));
 const requestedPage=Number(first(params.page));
 const page=Number.isFinite(requestedPage)?Math.max(1,Math.floor(requestedPage)):1;
 const subject=[make,model].filter(Boolean).join(' ')||'Автомобили';
 const title=`${subject}${country?` из ${country}`:''} — каталог и расчёт цены${page>1?` · страница ${page}`:''} — АвтоЦена`;
 const description=country?`${subject} из ${country}: предложения, фотографии и характеристики. Рассчитайте стоимость с таможенными платежами и доставкой в выбранный город России.`:'Каталог автомобилей из Японии, Китая, Кореи, ОАЭ, Европы и Грузии. Сравните предложения и рассчитайте стоимость с таможенными платежами и доставкой в Россию.';
 let canonical=country?`/cars/${market}`:'/cars';
 if(country&&make){canonical+=`/${encodeURIComponent(make)}`;if(model)canonical+=`/${encodeURIComponent(model)}`;}
 const q=new URLSearchParams();if(!country&&make)q.set('make',make);if(!country&&model)q.set('model',model);if(page>1&&Number.isFinite(page))q.set('page',String(page));
 if(q.size)canonical+='?'+q;
 const filtered=Object.keys(params).some(k=>first(params[k])&&!['market','make','model','page'].includes(k)&&!k.startsWith('utm_')&&!['yclid','gclid'].includes(k));
 return {title,description,alternates:{canonical},robots:{index:!filtered&&(!market||Boolean(country)),follow:true},openGraph:{title,description,url:canonical,type:'website',siteName:'АвтоЦена'}};
}
export const WEBSITE_SCHEMA={'@context':'https://schema.org','@type':'WebSite','@id':'https://avtocena.com/#website',url:'https://avtocena.com/',name:'АвтоЦена',alternateName:'AvtoCena',inLanguage:'ru-RU'};
