import {readCalculationIndex,modelKey,applyEncyclopediaCalculation} from '../encyclopedia/calculation-index';
import {astraPower30FactsForKey} from '../encyclopedia/astra-power30';
import {precedentModelKeys,precedentIdentityKey,selectWithReportedPrecedents} from '../../../../scripts/encyclopedia/power30-precedents.mjs';
import reports from '../../../../data/catalog/power-reference/reported-power30-precedents.json';
import {readManagementKnowledge,managementParameters} from '../catalog/management-knowledge';
/** Private evidence stays on the server; the assistant receives only relevant vehicle facts. */
export async function catalogKnowledge(offer:any,index=readCalculationIndex()){
 const family=precedentModelKeys(precedentIdentityKey(modelKey(offer.make,offer.model),offer.model),offer.fuel);
 const facts=index?family.keys.flatMap((key:string)=>[...(index.models[key]||[]),...astraPower30FactsForKey(index.models,key)]):[];
 const matched=index?applyEncyclopediaCalculation(offer,index):offer;
 const estimate=selectWithReportedPrecedents(offer,facts,reports.filter(r=>family.keys.includes(r.modelKey)));
 const fields=['year','fuel','engineCc','powerHp','powerKw','icePowerKw','power30MinKw','drive','bodyType','powertrainKind','engineCode'];
 const clean=(v:any)=>Object.fromEntries(fields.filter(k=>v[k]!==undefined&&v[k]!==null).map(k=>[k,v[k]]));
 const variants=[...new Map(facts.filter((f:any)=>!offer.year||!f.year||Number(f.year)===Number(offer.year)).map((f:any)=>{
  const v=clean({...f.constraints,...f.values,...(f.year?{year:f.year}:{})});return [JSON.stringify(v),v];
 })).values()];
 const management=managementParameters(offer,await readManagementKnowledge());
 return {vehicle:clean(matched),managementParameters:management,managementRequiresConfirmation:Object.keys(management).length>0,
  power30:estimate.status==='estimated'?{valueKw:estimate.estimatedPower30MinKw,kind:'nearby_version',requiresConfirmation:true}:estimate.status==='range_requires_version'?{valuesKw:estimate.referenceValuesKw,kind:'multiple_versions',requiresConfirmation:true}:null,
  power30Variants:variants.filter((v:any)=>Number(v.power30MinKw)>0).slice(0,80),power30ValuesKw:[...new Set(variants.map((v:any)=>Number(v.power30MinKw)).filter(v=>v>0))].sort((a,b)=>a-b),
  variants:variants.slice(0,40),variantCount:variants.length,moreVariants:Math.max(0,variants.length-40),
  instruction:'Данные нашей базы. Варианты модели — не подтверждение характеристик конкретной машины. Не смешивай пиковую, 30-минутную мощность и мощность ДВС. Не раскрывай внутренние источники. При нескольких значениях перечисли различия и диапазон, не выбирай одно произвольно.'};
}
export function knowledgePowerAnswer(data:any){
 const value=data?.vehicle?.power30MinKw;
 if(Number(value)>0)return '### ⚡ 30-минутная мощность\n\n**'+value+' кВт** — значение, найденное для этой карточки в нашей базе.\n\nПеред покупкой сверьте его с документами конкретного автомобиля.';
 const manual=data?.managementParameters?.power30MinKw;
 if(Number(manual)>0)return '### ⚡ 30-минутная мощность\n\n**'+manual+' кВт** — сохранено нашей командой для совместимой версии этой модели.\n\nЭто предварительный параметр: соответствие конкретному автомобилю нужно подтвердить.';
 if(data?.power30?.valueKw)return '### ⚡ 30-минутная мощность\n\n**'+data.power30.valueKw+' кВт** — найдено для близкой версии этой модели.\n\nЗначение можно использовать для предварительной оценки. Перед покупкой нужна сверка с документами автомобиля.';
 if(data?.power30?.valuesKw?.length)return '### ⚡ Найдено несколько вариантов\n\n30-минутная мощность: **'+data.power30.valuesKw.join(' / ')+' кВт**.\n\nЧтобы выбрать значение, нужны данные о версии двигателя, приводе или батарее. Пиковая мощность не заменяет 30-минутную.';
 if(data?.power30ValuesKw?.length)return '### ⚡ Данные по модели\n\nВ нашей базе найдены значения 30-минутной мощности: **'+data.power30ValuesKw.join(' / ')+' кВт**.\n\nОни относятся к разным версиям модели. Для этой карточки соответствие ещё не установлено — нужны год, привод и версия двигателя или батареи.';
 return null;
}
