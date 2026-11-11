import {enrichOfferWithSourceTableDisplacement} from '../catalog/source-table-displacement';
import type {VehicleOffer} from '../catalog/types';
import {translateCatalogText} from '../catalog/presentation';
import {autohomeNewSpecificationEvidence,parseAutohomeExactConfigFields,exactAutohomeSpecGalleryImages} from '../catalog/autohome-new-exact-source';
import {readSource} from './source';
import type {SourceDraft} from './load';
function pageData(html:string){
 const json=html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
 if(!json)throw Error('AutoHome не передал данные комплектации');
 return JSON.parse(json)?.props?.pageProps;
}
export function parseAutohomeDraft(html:string,specId:string,url:string,configHtml=''):SourceDraft{
 const p=pageData(html),d=p?.specDetails,b=d?.bread,s=d?.specinfo;
 if(String(p?.specId)!==specId||String(b?.specid)!==specId||String(s?.id)!==specId)throw Error('AutoHome вернул другую комплектацию');
 const fields=parseAutohomeExactConfigFields(configHtml,specId);
 const value=(key:string)=>d.configinfo?.find((x:any)=>x.key===key)?.value||'';
 const year=String(s.specname||'').match(/\b(20\d{2})款/)?.[1];
 const kw=String(value('最大功率')).match(/^(\d+(?:\.\d+)?)kW$/i)?.[1];
 const e=autohomeNewSpecificationEvidence({listingYear:year,energy:fields?.energy||s.funeldetail,engine:fields?.engine||value('排量'),displacementCcValues:fields?.displacementCcValues,engineMaxHp:fields?.engineMaxHp,engineMaxKw:fields?.engineMaxKw||kw});
 const draft:Record<string,string>={trim:s.specname||'',transmission:fields?.transmission||value('变速箱'),body:fields?.body||s.levelname||''};
 for(const key of ['year','fuel','engineCc','powerHp','powerKw'] as const)if(e[key].status==='exact'&&e[key].value!=null)draft[key]=String(e[key].value);
 if(e.powertrainKind.value==='series_hybrid')draft.fuel='series_hybrid';
 const photos=[d.imageinfo?.speclogo,...(d.imageinfo?.item||[]).map((x:any)=>x.img)].filter((x:unknown)=>typeof x==='string').map((x:string)=>x.replace(/^http:/,'https:')).filter((x:string)=>/^https:\/\/car\d+\.autoimg\.cn\/cardfs\/product\//.test(x));
 const notes=['На AutoHome указаны модельный год и рекомендованная цена в юанях. Перед публикацией уточните год выпуска и закупочную цену.'];
 if(!draft.engineCc&&e.powertrainKind.value!=='electric')notes.push('Точный объём в см³ не указан. Заполните по документам автомобиля.');
 if(draft.fuel==='hybrid'||draft.fuel==='series_hybrid'||draft.fuel==='electric')notes.push('Максимальная мощность электромотора не подставляется вместо 30-минутной. Укажите 30-минутную мощность по документам.');
 return {title:[s.brandname,s.seriesname,s.specname].filter(Boolean).join(' '),make:translateCatalogText(s.brandname||''),model:translateCatalogText(s.seriesname||''),market:'china',price:Number(s.minprice)>0?String(s.minprice):'',currency:'CNY',draft,url,images:[...new Set(photos)],notes};
}
export async function loadAutohomeDraft(specId:string,signal:AbortSignal):Promise<SourceDraft>{
 const url=`https://www.autohome.com.cn/spec/${specId}/`;
 const [page,config]=await Promise.all([readSource(url,signal),readSource(`https://car.autohome.com.cn/config/spec/${specId}.html`,signal).catch(()=>null)]);
 const data=parseAutohomeDraft(page.html,specId,url,config?.html);
 const series=String(pageData(page.html)?.seriesId||'');
 if(/^\d+$/.test(series)&&!signal.aborted){
  const gallery=await readSource(`https://www.autohome.com.cn/cars/imglist-x-x-${series}-${specId}-x-x-x-x-x-1.html`,signal).catch(()=>null);
  if(gallery){const exact=exactAutohomeSpecGalleryImages(gallery.html,specId);if(exact.length)data.images=exact;}
 }
 return data;
}

/** Old catalog rows may contain rounded litres. Recover cc only from their own retained evidence. */
export function savedAutohomeSpecification(offer:VehicleOffer):VehicleOffer{
 const table=enrichOfferWithSourceTableDisplacement({...offer,engineCc:undefined});
 if(table.engineCc)return table;
 const raw=offer.operational?.raw as any;
 const fields=raw?.configSpecId===String(offer.sourceOfferId)?raw.configFields:null;
 const evidence=fields?autohomeNewSpecificationEvidence({energy:fields.energy,engine:fields.engine,displacementCcValues:fields.displacementCcValues}):null;
 return {...offer,engineCc:evidence?.engineCc.status==='exact'?evidence.engineCc.value:undefined};
}
