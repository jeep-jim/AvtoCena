export type Power30Kind = "BEV" | "PHEV" | "HEV" | "MHEV" | "ICE" | "unknown";
export type Power30Inputs = { kind: Power30Kind; peak: string; torque: string; rpm: string; voltage: string };
export const emptyPower30Inputs: Power30Inputs = {kind:"unknown",peak:"",torque:"",rpm:"",voltage:""};
export type ThermalInputs = {efficiency:string; current:string; resistance:string; capacity:string; coolant:string; initial:string; limit:string; controller:string; usableEnergy:string};
export const emptyThermalInputs:ThermalInputs={efficiency:"",current:"",resistance:"",capacity:"",coolant:"",initial:"",limit:"",controller:"",usableEnergy:""};
const thermalLabels:Record<keyof ThermalInputs,string>={efficiency:"КПД привода",current:"Длительный ток",resistance:"Тепловое сопротивление",capacity:"Теплоёмкость",coolant:"Температура охлаждения",initial:"Начальная температура",limit:"Предельная температура",controller:"Длительный лимит контроллера",usableEnergy:"Доступная энергия батареи"};
export function missingThermalInputs(input:Power30Inputs,t:ThermalInputs){
 const missing:string[]=[];
 if(!input.peak.trim())missing.push("Пиковая мощность");
 if(!input.voltage.trim())missing.push("Рабочее напряжение");
 for(const key of ["efficiency","current","resistance","capacity","coolant","initial","limit","controller"] as const)if(!t[key].trim())missing.push(thermalLabels[key]);
 return missing;
}
/** One-node constant-efficiency thermal scenario, not an R85 certification model.
 * C dT/dt = Ploss - (T-Tcoolant)/R. Temperatures/limits must describe the same
 * equivalent drive and operating point; speed/peak-torque maxima are not paired.
 */
export function estimatePower30(input:Power30Inputs,t:ThermalInputs=emptyThermalInputs){
 if(!["BEV","PHEV","HEV","MHEV"].includes(input.kind))throw new Error("Выберите тип электромобиля или гибрида.");
 const missing=missingThermalInputs(input,t);if(missing.length)throw new Error("Для тепловой модели не хватает: "+missing.join(", ")+".");
 const read=(raw:string,min:number,max:number,label:string)=>{const n=Number(raw.replace(",","."));if(!Number.isFinite(n)||n<min||n>max)throw new Error("Проверьте поле: "+label+".");return n;};
 const peak=read(input.peak,.01,2000,"Пиковая мощность"),voltage=read(input.voltage,1,2000,"Напряжение");
 const eta=read(t.efficiency,1,99.99,"КПД")/100,current=read(t.current,.01,10000,"Длительный ток");
 const resistance=read(t.resistance,.0001,10,"Тепловое сопротивление"),capacity=read(t.capacity,.01,10000,"Теплоёмкость")*1000;
 const coolant=read(t.coolant,-60,150,"Температура охлаждения"),initial=read(t.initial,-60,300,"Начальная температура"),limit=read(t.limit,-59,300,"Предельная температура");
 const controller=read(t.controller,.01,2000,"Лимит контроллера");
 if(limit<=coolant||initial<coolant||initial>=limit)throw new Error("Нужны температуры: охлаждение ≤ начальная < предельная.");
 const decay=Math.exp(-1800/(resistance*capacity));
 const lossW=(limit-coolant-(initial-coolant)*decay)/(resistance*(-Math.expm1(-1800/(resistance*capacity))));
 const thermalKw=lossW*eta/(1-eta)/1000;
 const electricalKw=voltage*current*eta/1000;
 const limits=[{label:"Пиковая мощность",kw:peak},{label:"Нагрев за 30 минут",kw:thermalKw},{label:"Длительный ток",kw:electricalKw},{label:"Лимит контроллера",kw:controller}];
 const kw=Math.min(...limits.map(x=>x.kw));
 const lossAtOutput=kw*1000*(1/eta-1);
 const endTemperature=coolant+(initial-coolant)*decay+lossAtOutput*resistance*(1-decay);
 // Battery energy is a separate vehicle-duration check, never the R85 motor rating.
 const energyKw=input.kind==="BEV"&&t.usableEnergy.trim()?read(t.usableEnergy,.01,1000,"Доступная энергия")*eta/.5:undefined;
 return {kw,hp:kw*1.35962,limits,limiting:limits.filter(x=>Math.abs(x.kw-kw)<.001).map(x=>x.label).join(", "),endTemperature,lossKw:lossAtOutput/1000,energyKw,vehicleKw:energyKw===undefined?undefined:Math.min(energyKw,kw)};
}
export function power30OfferId(value: unknown) {
  if (typeof value !== "string" || value.length > 2048) throw new Error("Вставьте ссылку на автомобиль с avtocena.com.");
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("Вставьте полную ссылку на автомобиль с avtocena.com."); }
  if (!["https:","http:"].includes(url.protocol) || !["avtocena.com","www.avtocena.com"].includes(url.hostname) || url.port || url.username || url.password) throw new Error("Поддерживаются только ссылки на автомобили с avtocena.com.");
  const path = url.pathname.match(/^\/cars\/offer\/([^/]+)\/?$/);
  if (!path) throw new Error("Нужна ссылка на карточку автомобиля, а не на каталог.");
  let segment: string;
  try {segment = decodeURIComponent(path[1]);} catch {throw new Error("Некорректная ссылка.");}
  const id = segment.includes("--") ? segment.slice(segment.lastIndexOf("--") + 2) : segment;
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) throw new Error("Некорректный номер объявления.");
  return id;
}
export type Power30Car = {
  id: string; title: string; href: string; image?: string; inputs: Power30Inputs;
  inputSources: Partial<Record<keyof Power30Inputs,string>>;
  certified?: {kw:number; source:string; url?:string};
  reported?: {kw:number; peakKw:number; source:string; recordedAt:string};
  technical?: {batteryKwh?:number; motorType?:string; cooling?:string};
  notes: string[];
};
