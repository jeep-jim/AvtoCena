import {exactKoreaReportUrl, type KoreaSourceReportKind} from './korea-report-types';
import {koreaBodyParts,koreaBodyConditions,type KoreaBodyInspection,type KoreaBodyCondition,type KoreaBodyPartKey} from './korea-inspection-schema';
export type KoreaReportField={key:string;label:string;value:string;group?:string};
export type KoreaReportDocument={version:1;lot:string;kind:KoreaSourceReportKind;fields:KoreaReportField[];partial:true;body?:KoreaBodyInspection};
const labels:Record<string,[string,string]>={
 '사고이력':['structuralDamage','Повреждения силовых элементов по осмотру'],
 '단순수리':['panelRepair','Ремонт наружных панелей по осмотру'],
 '연식':['year','Год выпуска'], '최초등록일':['firstRegistration','Первая регистрация'],
 '주행거리':['mileage','Пробег при осмотре'], '주행거리및계기상태':['mileage','Пробег при осмотре'],
 '주행거리계기상태':['odometer','Состояние одометра'],
 '용도변경':['useChange','Изменение назначения автомобиля'],
};
const text=(s:string)=>s.replace(/<!--[\s\S]*?-->/g,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/\s+/g,' ').trim();
const normalized=(s:string)=>text(s).replace(/\s/g,'');
function classes(attributes:string){return /\bclass\s*=\s*["']([^"']*)["']/i.exec(attributes)?.[1].split(/\s+/)||[];}
function selected(cell:string):string|undefined{
 const spans=[...cell.matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span>/gi)].filter(m=>classes(m[1]).includes('txt_state'));
 if(!spans.length)return text(cell);
 const checked=spans.filter(m=>classes(m[1]).some(c=>c==='on'||c==='active'));
 // Neither missing marks nor conflicting checkboxes are a negative finding.
 return checked.length===1?text(checked[0][2]):undefined;
}
function date(raw:string):string|undefined{
 const m=/^(\d{4})(?:년\s*|[.\-/])(\d{2})(?:월\s*|[.\-/])(\d{2})일?$/.exec(raw);
 if(!m)return;const iso=`${m[1]}-${m[2]}-${m[3]}`;const parsed=new Date(iso);return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===iso?`${m[3]}.${m[2]}.${m[1]}`:undefined;
}
const states:Record<string,string>={'양호':'Исправно','불량':'Неисправно','없음':'Не отмечено','있음':'Отмечено','미세누유':'Следы масла','누유':'Утечка масла','미세누수':'Следы охлаждающей жидкости','누수':'Утечка охлаждающей жидкости','적정':'В норме','부족':'Недостаточно','과다':'Избыток'};
const groups:Record<string,string>={'자기진단':'Самодиагностика','원동기':'Двигатель','변속기':'Коробка передач','동력전달':'Трансмиссия','조향':'Рулевое управление','제동':'Тормоза','전기':'Электрооборудование','연료':'Топливная система'};
const components:Record<string,string>={
 '원동기':'Двигатель','변속기':'Коробка передач','작동상태(공회전)':'Работа на холостом ходу',
 '오일누유':'Утечка масла','냉각수누수':'Утечка охлаждающей жидкости','실린더커버(로커암커버)':'Клапанная крышка',
 '실린더헤드/개스킷':'Головка блока / прокладка','실린더블록/오일팬':'Блок цилиндров / поддон',
 '오일유량':'Уровень масла','워터펌프':'Водяной насос','라디에이터':'Радиатор','냉각수수량':'Уровень охлаждающей жидкости',
 '자동변속기(A/T)':'АКПП','오일유량및상태':'Уровень и состояние масла',
 '클러치어셈블리':'Сцепление','등속조인트':'ШРУСы','추진축및베어링':'Карданный вал и подшипники','디퍼렌셜기어':'Дифференциал',
 '동력조향작동오일누유':'Утечка масла усилителя руля','작동상태':'Работа',
 '스티어링펌프':'Насос усилителя руля','스티어링기어(MDPS포함)':'Рулевой механизм / электроусилитель',
 '스티어링조인트':'Рулевые шарниры','파워고압호스':'Шланг высокого давления','타이로드엔드및볼조인트':'Рулевые наконечники и шаровые шарниры',
 '브레이크마스터실린더오일누유':'Утечка жидкости главного тормозного цилиндра','브레이크오일누유':'Утечка тормозной жидкости','배력장치상태':'Усилитель тормозов',
 '발전기출력':'Генератор','시동모터':'Стартер','와이퍼모터기능':'Привод стеклоочистителей','실내송풍모터':'Вентилятор салона','라디에이터팬모터':'Вентилятор радиатора','윈도우모터':'Стеклоподъёмники','연료누출(LP가스포함)':'Утечка топлива / газа',
};
/** Read the known three-column header hierarchy, including rowspan. Never guess
 * which system an identical component label belongs to. No HTML is returned. */
function mechanicalFields(html:string):KoreaReportField[]{
 const table=[...html.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi)].find(m=>classes(m[1]).includes('tbl_detail'))?.[2];
 if(!table)return [];
 const carry:Array<{label:string;remaining:number}|undefined>=[],result:KoreaReportField[]=[];
 for(const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  const headers:Array<string|undefined>=Array.from({length:3},(_,i)=>carry[i]?.label);
  for(let i=0;i<3;i++){if(carry[i]&&--carry[i]!.remaining===0)carry[i]=undefined;}
  let column=0,cell:string|undefined;
  for(const m of row[1].matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi)){
   if(m[1].toLowerCase()==='td'){cell=m[3];break;}
   while(column<3&&headers[column]!==undefined)column++;
   if(column>=3)break;
   const colspan=Number(/\bcolspan=["'](\d+)["']/.exec(m[2])?.[1]||1),rowspan=Number(/\browspan=["'](\d+)["']/.exec(m[2])?.[1]||1);
   if(colspan<1||colspan>3||rowspan<1||rowspan>40||column+colspan>3){cell=undefined;break;}
   for(let i=0;i<colspan;i++){headers[column]=normalized(m[3]);if(rowspan>1)carry[column]={label:headers[column]!,remaining:rowspan-1};column++;}
  }
  if(cell===undefined||headers.some(h=>!h))continue;
  const [group,...parts]=headers as string[],terms=[...new Set(parts)];
  if(!groups[group]||terms.some(p=>!components[p]))continue;
  const raw=selected(cell);if(!raw||!states[raw])continue;
  let value=states[raw];
  if(group==='제동'&&raw==='누유')value='Утечка тормозной жидкости';
  if(group==='제동'&&raw==='미세누유')value='Следы тормозной жидкости';
  result.push({key:`mechanical:${headers.join('/')}`,group:groups[group],label:terms.map(p=>components[p]).join(' · '),value});
 }
 return result;
}
function bodyInspection(html:string):KoreaBodyInspection|undefined{
 const matches=[...html.matchAll(/performanceCheck\.init\(\s*\{\s*data\s*:\s*(\{[^{}]{1,16000}\})\s*\}\s*\)/g)];
 if(matches.length!==1)return;
 try{
  const keys=[...matches[0][1].matchAll(/"([^"]+)"\s*:/g)].map(m=>m[1]);if(new Set(keys).size!==keys.length)return;
  const data=JSON.parse(matches[0][1]);if(!data||Array.isArray(data))return;
  const parts:KoreaBodyInspection['parts']=[];let unmapped=false;
  for(const [key,value] of Object.entries(data)){
   if(!Object.hasOwn(koreaBodyParts,key)){if(value!==null)unmapped=true;continue;}
   if(value!==null&&(!Array.isArray(value)||value.length>6||value.some(v=>typeof v!=='string'||!Object.hasOwn(koreaBodyConditions,v)))){unmapped=true;continue;}
   parts.push({key:key as KoreaBodyPartKey,conditions:[...new Set((value||[]) as KoreaBodyCondition[])]});
  }
  return parts.length?{parts,unmapped}:undefined;
 }catch{return;}
}
/** Only explicitly labelled, identity-bound facts. Missing marks never mean clean history. */
export function parseKoreaInspectionDocument(html:string,lot:string):KoreaReportDocument|null {
 if(!/^\d{6,10}$/.test(lot)||Buffer.byteLength(html)>512*1024||/captcha|has_been_cr_blocked|security verification/i.test(html))return null;
 const ids=[...html.matchAll(/"carid"\s*:\s*"(\d+)"/g)].map(m=>m[1]);
 if(!ids.length||ids.some(id=>id!==lot))return null;
 const fields=new Map<string,KoreaReportField>();let conflict=false;
 const add=(field:KoreaReportField)=>{const previous=fields.get(field.key);if(previous&&previous.value!==field.value)conflict=true;else fields.set(field.key,field);};
 // Remove scripts, comments and tooltip links before interpreting table labels.
 const clean=html.replace(/<!--[\s\S]*?-->/g,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi,'');
 for(const match of clean.matchAll(/<th\b[^>]*>((?:(?!<t[hd]\b)[\s\S])*?)<\/th>\s*<td\b[^>]*>((?:(?!<t[hd]\b)[\s\S])*?)<\/td>/gi)){
  const label=normalized(/<em\b[^>]*class="txt_name"[^>]*>([\s\S]*?)<\/em>/i.exec(match[1])?.[1]||match[1]);
  const definition=labels[label];if(!definition)continue;
  const [key,title]=definition,raw=selected(match[2]);let value:string|undefined;
  if(!raw)continue;
  if(['structuralDamage','panelRepair','useChange'].includes(key))value=raw==='없음'?'Не отмечены':raw==='있음'?'Отмечены':undefined;
  if(key==='odometer')value=states[raw];
  if(key==='year'&&/^(?:19|20)\d{2}\s*년?$/.test(raw))value=raw.replace(/\s*년$/,'');
  if(key==='mileage'&&/^\d[\d, ]*\s*(?:km|㎞)$/i.test(raw))value=raw.replace(/[, ]/g,'').replace(/km|㎞/i,' км');
  if(key==='firstRegistration')value=date(raw);
  if(value)add({key,label:title,value});
 }
 // The structured form keeps the numeric mileage in the following detail cell.
 for(const row of clean.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  if(normalized(/<th\b[^>]*>([\s\S]*?)<\/th>/.exec(row[1])?.[1]||'')!=='주행거리')continue;
  const details=[...row[1].matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span>/gi)].filter(m=>classes(m[1]).includes('txt_detail'));
  for(const detail of details){const raw=text(detail[2]);if(/^\d[\d, ]*\s*(?:km|㎞)$/i.test(raw))add({key:'mileage',label:'Пробег при осмотре',value:raw.replace(/[, ]/g,'').replace(/km|㎞/i,' км')});}
 }
 for(const field of mechanicalFields(clean))add(field);
 const signedDate=/<div\b[^>]*class=["']inspc_sign["'][^>]*>[\s\S]*?<p\b[^>]*class=["']date["'][^>]*>([\s\S]*?)<\/p>/i.exec(clean);
 if(signedDate){const value=date(text(signedDate[1]));if(value)add({key:'inspectionDate',label:'Дата осмотра',value});}
 // This explicit inspector note does not provide incident dates, sums or a count.
 const opinion=[...clean.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi)].find(m=>classes(m[1]).includes('tbl_opinion'))?.[2];
 if(opinion&&/\*보험이력있음\s*$/.test(text(opinion)))add({key:'insuranceNote',label:'Примечание инспектора',value:'Указана страховая история. Случаи и суммы в этом осмотре не приведены.'});
 const body=bodyInspection(html);
 if(conflict||(!fields.size&&!body))return null;
 return {version:1,lot,kind:'inspection',fields:[...fields.values()],partial:true,...(body?{body}:{})};
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
