import {createHash} from 'node:crypto';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fields=new Set(['year','powerHp','powerKw','productionMonth','productionDay','transportToBorderRub','grossVehicleWeightKg','engineCc','power30MinKw','icePowerKw']);
const errors=new Map([['Укажите тип топлива','fuel_required'],['Укажите тип гибрида','hybrid_kind_required'],['Укажите существующий день и месяц выпуска','production_date_invalid'],['Выберите категорию M1 или N1','vehicle_category_invalid'],['Укажите существующую дату расчёта','calculation_date_invalid'],['Укажите топливо ДВС гибрида','hybrid_ice_fuel_required']]);
const fuelVocabulary=new Set(['Бензин','Дизель','Гибрид','Электричество','Газ','LPG','LPI','CNG','GPL','LPG (Газ)','Сжиженный газ','СУГ','LPG/Бензин','Бензин/Электричество','Дизель/Электричество','Водород','Водородный','Hydrogen','FCEV','Бензин+Газ','Бензин + Газ','Бензин/Газ','Сжиженный нефтяной газ','Этанол','petrol','diesel','hybrid','electric']);
export function safeValidationError(error){const m=/^Проверьте поле ([A-Za-z0-9]+)$/.exec(error?.message||'');return m&&fields.has(m[1])?'invalid_'+m[1]:errors.get(error?.message)||'unknown_validation_error';}
/** Call with actual raw+actual generated draft inside existing pinned inspector.
 * Only failures returned. Never export arbitrary exception/source text. */
export function safeRejectionDetails(error,d,draft){
 const label=typeof d.engine_type==='string'?d.engine_type:null;
 const status=v=>v===null||v===undefined||v===''?'missing':typeof v==='number'&&Number.isFinite(v)||typeof v==='string'&&/^\d+(?:\.\d+)?$/.test(v)?'numeric':'other';
 const number=v=>(typeof v==='number'||typeof v==='string'&&/^\d+(?:\.\d+)?$/.test(v))&&Number.isFinite(Number(v))&&Number(v)>0&&Number(v)<=2500?Number(v):null;
 return {validationCode:safeValidationError(error),sourceFuel:{...safeFuelWords(label),token:fuelVocabulary.has(label)?label:'unlisted',sha256:hash(label),length:label?.length??0},draftPresence:Object.fromEntries([...fields].map(k=>[k,status(draft[k])])),sourcePower:{totalHp:number(d.power),iceHp:number(d.power_ice_hp),electricPeakKw:number(d.power_electro_kw),totalStatus:status(d.power),iceStatus:status(d.power_ice_hp),electricPeakStatus:status(d.power_electro_kw)},supplierCertified30MinNotEstablishedByThisDiagnostic:true};
}
export function diagnoseDraftRejection({raw,draft,coordinate,validate}){
 try{validate(draft);return null;}catch(error){return {coordinate,rawSha256:hash(raw),identitySha256:hash(String(raw.inner_id)),...safeRejectionDetails(error,raw.data,draft)};}
}

export function safeFuelWords(label){
 if(typeof label!=='string'||label.length>160)return {recognizedTokens:[],separatorClass:'unlisted'};
 const words=new Map([['газ','gas'],['lpg','lpg'],['lpi','lpi'],['cng','cng'],['gpl','gpl'],['бензин','petrol'],['petrol','petrol'],['gasoline','petrol'],['дизель','diesel'],['diesel','diesel'],['гибрид','hybrid'],['hybrid','hybrid'],['электричество','electric'],['electric','electric'],['водород','hydrogen'],['hydrogen','hydrogen'],['fcev','fcev']]);
 const parts=label.toLowerCase().split(/[\s()/+,;|\-]+/).filter(Boolean);
 if(!parts.length||parts.length>8||parts.some(w=>!words.has(w)))return {recognizedTokens:[],separatorClass:'unlisted'};
 const separators=[['slash',/\//],['plus',/\+/],['parentheses',/[()]/],['other',/[,;|\-]/]].filter(([,re])=>re.test(label)).map(([name])=>name);
 return {recognizedTokens:[...new Set(parts.map(w=>words.get(w)))],separatorClass:separators.length>1?'mixed':separators[0]||'plain'};
}
