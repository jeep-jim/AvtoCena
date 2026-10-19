import type {SourceSpecificationSnapshot} from './source-specifications';
const labels:Record<string,string>={
 'engine turbo':'Турбонаддув','maximum power(kw)':'Максимальная мощность, кВт','maximum power (kw)':'Максимальная мощность, кВт',
 'maximum horsepower (ps)':'Максимальная мощность, л.с.','maximum net power (kw)':'Максимальная полезная мощность, кВт',
 'maximum torque (n.m)':'Максимальный крутящий момент, Н·м','engine model':'Модель двигателя',
 'displacement (ml)':'Рабочий объём, см³','displacement(l)':'Рабочий объём, л','fuel form':'Топливо',
 'fuel mark':'Требуемое топливо','fuel supply method':'Система подачи топлива','engine layout':'Расположение двигателя',
 'gearbox':'Коробка передач','gearbox type':'Тип коробки передач','number of gears':'Число передач','drive mode':'Привод',
 'body structure':'Конструкция кузова','kuzov type':'Тип кузова','length (mm)':'Длина, мм','width (mm)':'Ширина, мм',
 'height (mm)':'Высота, мм','wheelbase (mm)':'Колёсная база, мм','number of doors':'Число дверей',
 'number of seats (seats)':'Число мест','fuel tank volume (l)':'Объём топливного бака, л',
 'trunk volume (l)':'Объём багажника, л','curb weight (kg)':'Снаряжённая масса, кг',
 'maximum full load mass (kg)':'Максимальная полная масса, кг','top speed (km/h)':'Максимальная скорость, км/ч',
 'wltc fuel consumption (l/100 km)':'Расход топлива WLTC, л/100 км',
 'front tire specifications':'Передние шины','rear tire specifications':'Задние шины',
 'front suspension type':'Передняя подвеска','rear suspension type':'Задняя подвеска',
 'front brake type':'Передние тормоза','rear brake type':'Задние тормоза',
};
function clean(value:string){
 return value.replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&times;/gi,'×').replace(/&ndash;/gi,'–')
 .replace(/&#(x[0-9a-f]+|\d+);/gi,(_,v)=>{const n=v[0].toLowerCase()==='x'?parseInt(v.slice(1),16):Number(v);return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):'';}).replace(/\s+/g,' ').trim();
}
const translated:Record<string,string>={'yes':'Да','no':'Нет','gasoline':'Бензин','petrol':'Бензин','diesel':'Дизель','electric':'Электро','hybrid':'Гибрид','ff':'Передний','fr':'Задний','4wd':'Полный','awd':'Полный','suv':'Внедорожник / кроссовер','sedan':'Седан','hatchback':'Хэтчбек','wagon':'Универсал','mpv':'Минивэн','pickup':'Пикап','unibody':'Несущий кузов','transverse':'Поперечное','longitudinal':'Продольное','multi-point efi':'Распределённый впрыск'};
function display(value:string){
 return translated[value.toLowerCase()]||value.replace(/^(\d+)-speed Manual$/i,'$1-ступенчатая механическая').replace(/^(\d+)-speed Automatic$/i,'$1-ступенчатая автоматическая').replace(/^(\d+)-door (\d+) Seats SUV$/i,'$1 дверей, $2 мест, внедорожник / кроссовер').replace(/^(\d+) RON gasoline$/i,'Бензин, RON $1');
}
/** Read named technical lines only. Descriptions, contacts, prices and scripts are excluded.
 * Maximum/net motor power is never treated as certified 30-minute power.
 */
export function ajesSourceDetails(value:unknown){
 const fields:Record<string,string[]>={};
 if(typeof value!=='string'||value.length>128*1024)return {fields,groups:[] as SourceSpecificationSnapshot['groups']};
 const lines=value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'')
 .replace(/<br\s*\/?>|<\/(?:p|div|tr)>/gi,'\n').replace(/<[^>]*>/g,' ').split(/\r?\n/).slice(0,1000);
 for(const line of lines){const at=line.indexOf(':');if(at<0)continue;const key=clean(line.slice(0,at)).toLowerCase(),text=clean(line.slice(at+1));if(!labels[key]||!text||text==='-'||text.length>180)continue;const values=fields[key]||(fields[key]=[]);if(!values.includes(text)&&values.length<3)values.push(text);}
 const items=Object.entries(fields).flatMap(([key,values])=>values.map(value=>({name:labels[key],value:display(value)}))).slice(0,80);
 return {fields,groups:items.length?[{name:'Характеристики из объявления',items}]:[]};
}
export function ajesDetailValues(details:ReturnType<typeof ajesSourceDetails>){
 const unique=(keys:string[])=>{const values=[...new Set(keys.flatMap(k=>details.fields[k]||[]))];return values.length===1?values[0]:undefined;};
 const numeric=(keys:string[],min:number,max:number)=>{const raw=unique(keys);if(!raw||!/^\d+(?:\.\d+)?$/.test(raw))return;const n=Number(raw);return n>=min&&n<=max?n:undefined;};
 const horsepower=numeric(['maximum horsepower (ps)'],1,2500);
 const engineCc=numeric(['displacement (ml)'],300,20000);
 const fuel=({gasoline:'petrol',petrol:'petrol',diesel:'diesel',electric:'electric',hybrid:'hybrid'} as Record<string,string>)[unique(['fuel form'])?.toLowerCase()||''];
 const drive=({FF:'fwd',FR:'rwd',FWD:'fwd',RWD:'rwd','4WD':'awd',AWD:'awd'} as Record<string,string>)[unique(['drive mode'])?.toUpperCase()||''];
 const gearbox=unique(['gearbox']),transmission=gearbox&&/^\d+-speed Manual$/i.test(gearbox)?'manual':gearbox&&/^\d+-speed Automatic$/i.test(gearbox)?'automatic':undefined;
 const bodyMap:Record<string,string>={suv:'suv',sedan:'sedan',hatchback:'hatchback',wagon:'wagon',mpv:'minivan',pickup:'pickup',coupe:'coupe',convertible:'convertible'};
 const bodies=[...new Set(['kuzov type','body structure'].flatMap(k=>details.fields[k]||[]).map(v=>bodyMap[v.toLowerCase()]||(/^\d+-door \d+ Seats SUV$/i.test(v)?'suv':undefined)).filter(Boolean))];
 return {horsepower,engineCc,fuel,drive,transmission,bodyType:bodies.length===1?bodies[0]:undefined};
}
