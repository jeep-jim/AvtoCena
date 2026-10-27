import {exactKoreaReportUrl, type KoreaSourceReportKind} from './korea-report-types';
export type KoreaReportField={key:string;label:string;value:string};
export type KoreaReportDocument={version:1;lot:string;kind:KoreaSourceReportKind;fields:KoreaReportField[];partial:true};
const labels:Record<string,[string,string]>={
 '사고이력':['structuralDamage','Повреждения силовых элементов по осмотру'],
 '단순수리':['panelRepair','Ремонт наружных панелей по осмотру'],
 '연식':['year','Год выпуска'], '최초등록일':['firstRegistration','Первая регистрация'],
 '주행거리':['mileage','Пробег при осмотре'], '주행거리및계기상태':['mileage','Пробег при осмотре'],
};
const text=(s:string)=>s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/\s+/g,' ').trim();
/** Only explicitly labelled facts. A missing field is never a negative finding. */
export function parseKoreaInspectionDocument(html:string,lot:string):KoreaReportDocument|null {
 if(!/^\d{6,10}$/.test(lot)||html.length>512*1024||/captcha|has_been_cr_blocked|security verification/i.test(html))return null;
 const ids=[...html.matchAll(/"carid"\s*:\s*"(\d+)"/g)].map(m=>m[1]);
 if(!ids.length||ids.some(id=>id!==lot))return null;
 const fields=new Map<string,KoreaReportField>();
 for(const match of html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>\s*<td\b[^>]*>([\s\S]*?)<\/td>/gi)){
  const label=text(/<em\b[^>]*class="txt_name"[^>]*>([\s\S]*?)<\/em>/i.exec(match[1])?.[1]||match[1]).replace(/\s/g,'');
  const definition=labels[label];if(!definition)continue;
  const [key,title]=definition,raw=text(match[2]);let value:string|undefined;
  if(key==='structuralDamage'||key==='panelRepair')value=raw==='없음'?'Не отмечены':raw==='있음'?'Отмечены':undefined;
  if(key==='year'&&/^(?:19|20)\d{2}\s*년?$/.test(raw))value=raw.replace(/\s*년$/,'');
  if(key==='mileage'&&/^\d[\d, ]*\s*(?:km|㎞)$/i.test(raw))value=raw.replace(/[, ]/g,'').replace(/km|㎞/i,' км');
  if(key==='firstRegistration'&&/^\d{4}[.\-/]\d{2}[.\-/]\d{2}$/.test(raw))value=raw;
  if(!value)continue;
  const previous=fields.get(key);if(previous&&previous.value!==value)return null;
  fields.set(key,{key,label:title,value});
 }
 return fields.size?{version:1,lot,kind:'inspection',fields:[...fields.values()],partial:true}:null;
}
function documentUrl(value:string,lot:string):boolean {
 if(exactKoreaReportUrl(value,lot,'inspection'))return true;
 const u=new URL(value);
 return u.protocol==='https:'&&u.hostname==='www.encar.com'&&!u.username&&!u.password&&!u.port&&!u.hash&&u.pathname==='/md/sl/mdsl_regcar.do'&&u.searchParams.get('method')==='inspectionImgView'&&u.searchParams.get('ver')==='v202006'&&u.searchParams.get('carid')===lot&&[...u.searchParams.keys()].length===3;
}
/** Follow only the observed same-LOT image-view redirect; never solve challenges. */
export async function readKoreaInspectionDocument(originalHref:string,lot:string,fetcher:typeof fetch=fetch):Promise<KoreaReportDocument|null>{
 if(!exactKoreaReportUrl(originalHref,lot,'inspection'))return null;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4000);
 try{
  let url=originalHref;
  for(let hop=0;hop<2;hop++){
   const response=await fetcher(url,{signal:controller.signal,redirect:'manual',cache:'no-store'});
   if([301,302,303,307,308].includes(response.status)){
    await response.body?.cancel();const location=response.headers.get('location');if(!location||hop===1)return null;
    const next=new URL(location,url).href;if(!documentUrl(next,lot))return null;url=next;continue;
   }
   if(!response.ok||!response.headers.get('content-type')?.includes('text/html')||Number(response.headers.get('content-length'))>512*1024){await response.body?.cancel();return null;}
   const reader=response.body?.getReader();if(!reader)return null;
   const chunks:Uint8Array[]=[];let size=0;
   while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>512*1024){await reader.cancel();return null;}chunks.push(value);}
   const charset=/charset\s*=\s*([\w-]+)/i.exec(response.headers.get('content-type')||'')?.[1]||'utf-8';
   if(!['utf-8','euc-kr','ks_c_5601-1987'].includes(charset.toLowerCase()))return null;
   return parseKoreaInspectionDocument(new TextDecoder(charset).decode(Buffer.concat(chunks)),lot);
  }
 }catch{return null;}finally{clearTimeout(timer);}
 return null;
}
