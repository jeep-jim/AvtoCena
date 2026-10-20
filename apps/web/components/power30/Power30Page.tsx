"use client";
import {useEffect,useRef,useState} from "react";
import {emptyPower30Inputs,emptyThermalInputs,missingThermalInputs,estimatePower30,type ThermalInputs,type Power30Car,type Power30Inputs,type Power30Kind} from "../../lib/power30/calculator";
import styles from "./Power30Page.module.css";
const kinds:Record<Power30Kind,string>={unknown:"Уточните тип автомобиля",BEV:"Электромобиль (BEV)",PHEV:"Подключаемый / последовательный гибрид",HEV:"Обычный гибрид (HEV)",MHEV:"Мягкий гибрид (MHEV)",ICE:"ДВС без тягового электромотора"};
const fields=[{key:"peak",label:"Пиковая мощность электромоторов, кВт",placeholder:"Например, 150",max:2000},{key:"torque",label:"Максимальный момент (справочно), Н·м",placeholder:"Если известен",max:20000},{key:"rpm",label:"Максимальные обороты (справочно)",placeholder:"Если известны",max:100000},{key:"voltage",label:"Рабочее напряжение DC, В",placeholder:"При длительной нагрузке",max:2000}] as const;
const thermalFields=[
 {key:"efficiency",label:"КПД привода в рабочем режиме, %",min:1,max:99.99},
 {key:"current",label:"Допустимый ток DC на 30 минут, А",min:.01,max:10000},
 {key:"resistance",label:"Тепловое сопротивление, К/Вт",min:.0001,max:10},
 {key:"capacity",label:"Эквивалентная теплоёмкость, кДж/К",min:.01,max:10000},
 {key:"coolant",label:"Температура охлаждения, °C",min:-60,max:150},
 {key:"initial",label:"Начальная температура привода, °C",min:-60,max:300},
 {key:"limit",label:"Предельная температура привода, °C",min:-59,max:300},
 {key:"controller",label:"Длительный лимит контроллера, кВт",min:.01,max:2000},
] as const;
const format=(n:number)=>n.toLocaleString("ru-RU",{maximumFractionDigits:2});
export function Power30Page(){
 const [url,setUrl]=useState("");const [car,setCar]=useState<Power30Car|null>(null);
 const [inputs,setInputs]=useState<Power30Inputs>({...emptyPower30Inputs});
 const [thermal,setThermal]=useState<ThermalInputs>({...emptyThermalInputs});
 const [sources,setSources]=useState<Power30Car["inputSources"]>({});
 const [estimate,setEstimate]=useState<ReturnType<typeof estimatePower30>|null>(null);
 const [error,setError]=useState("");const [busy,setBusy]=useState(false);const [photoFailed,setPhotoFailed]=useState(false);
 const active=useRef<AbortController|null>(null);const generation=useRef(0);
 useEffect(()=>()=>{generation.current++;active.current?.abort();},[]);
 function clear(){generation.current++;active.current?.abort();setCar(null);setEstimate(null);setInputs({...emptyPower30Inputs});setThermal({...emptyThermalInputs});setSources({});setPhotoFailed(false);setError("");setBusy(false);}
 async function load(value:string){
  clear();const sequence=generation.current;const controller=new AbortController();active.current=controller;setBusy(true);
  const timer=setTimeout(()=>controller.abort(),25000);
  try{
   const response=await fetch(`/api/power30?${new URLSearchParams({url:value})}`,{signal:controller.signal,cache:"no-store"});
   const data=await response.json();if(sequence!==generation.current)return;
   if(!response.ok)throw new Error(data.error || "Не удалось загрузить автомобиль.");
   const next=data as Power30Car;setCar(next);setInputs(next.inputs);setSources(next.inputSources);

  }catch(e){if(sequence===generation.current)setError(controller.signal.aborted?"Загрузка заняла слишком много времени. Повторите попытку.":e instanceof Error?e.message:"Не удалось загрузить автомобиль.");}
  finally{clearTimeout(timer);if(sequence===generation.current)setBusy(false);}
 }
 function edit(key:keyof Power30Inputs,value:string){setInputs(old=>({...old,[key]:value}));setSources(old=>({...old,[key]:"Введено вручную"}));setEstimate(null);setError("");}
 const missing=missingThermalInputs(inputs,thermal);
 return <main className={styles.page}><div className={styles.wrap}>
  <div className={styles.top}><a href="/cars">АвтоЦена</a><span>Экспериментальный расчёт</span></div>
  <div className={styles.columns}><div className={styles.vehicle}><div className={styles.photo} aria-busy={busy}>
   {car?.image&&!photoFailed?<img src={car.image} alt={car.title} onError={()=>setPhotoFailed(true)}/>:<div><span className={styles.symbol}>⚡</span><p>{busy?"Загружаем автомобиль…":car?"Фото недоступно":"Фото автомобиля появится здесь"}</p></div>}
  </div>
  {car&&<a className={styles.carTitle} href={car.href} target="_blank" rel="noreferrer">{car.title} ↗</a>}
  <form className={styles.linkForm} onSubmit={event=>{event.preventDefault();void load(url);}}>
   <label htmlFor="power30-url">Ссылка на автомобиль с АвтоЦены</label>
   <div><input id="power30-url" type="url" required value={url} placeholder="https://avtocena.com/cars/offer/…" onChange={event=>{clear();setUrl(event.target.value);}} onPaste={event=>{const value=event.clipboardData.getData("text").trim();if(/^https?:\/\//i.test(value)){event.preventDefault();setUrl(value);void load(value);}}}/><button disabled={busy} type="submit">{busy?"Загрузка…":"Загрузить"}</button></div>
  </form>
  {error&&<p role="alert" className={styles.error}>{error}</p>}
  {car?.technical&&<dl className={styles.specs}>{car.technical.motorType&&<><dt>Электромотор</dt><dd>{car.technical.motorType}</dd></>}{car.technical.batteryKwh&&<><dt>Батарея по объявлению</dt><dd>{format(car.technical.batteryKwh)} кВт·ч</dd></>}</dl>}
  <div className={styles.sourceNote}><strong>Источники мощности</strong><p>Сначала проверяются параметры карточки и документы подходящей модификации. Затем — отдельно указанные владельцем значения. Если их нет, для физической модели нужны данные об охлаждении, потерях и длительных ограничениях привода.</p><p>Пустое поле означает «неизвестно», а не ноль. Тип мотора, масса машины и размер батареи сами по себе не задают 30-минутную мощность.</p></div>
  </div><section className={styles.panel}>
   <h1>Расчёт 30-мин мощности</h1><p className={styles.intro}>Вставьте ссылку — найденные значения и параметры появятся автоматически. Ниже можно проверить отдельный тепловой сценарий.</p>
   {car?.certified&&<div className={styles.certified}><span>30-минутная мощность по данным автомобиля</span><strong>{format(car.certified.kw)} кВт <small> / {format(car.certified.kw*1.35962)} л.с.</small></strong><p>Источник: {car.certified.source}</p>{car.certified.url&&<a href={car.certified.url} target="_blank" rel="noreferrer">Открыть документ ↗</a>}<p>Значение относится к загруженной карточке и не меняется при редактировании экспериментального расчёта.</p></div>}
   {car?.reported&&<div className={styles.reported}><span>Ориентир для этой карточки · со слов владельца</span><strong>{format(car.reported.kw)} кВт <small>/ {format(car.reported.kw*1.35962)} л.с.</small></strong><p>{car.reported.source}. Дата: {car.reported.recordedAt}.</p><p>{car.reported.kw} / {car.reported.peakKw} = {format(car.reported.kw/car.reported.peakKw)}. Это отношение для одного примера, не универсальный коэффициент.</p></div>}
   <form onSubmit={event=>{event.preventDefault();try{setEstimate(estimatePower30(inputs,thermal));setError("");}catch(e){setEstimate(null);setError((e as Error).message);}}}>
    <label className={styles.field}>Тип автомобиля<select value={inputs.kind} onChange={event=>edit("kind",event.target.value)}>{Object.entries(kinds).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><small>{sources.kind||"Выберите тип силовой установки"}</small></label>
    <div className={styles.grid}>{fields.map(field=><label key={field.key} className={styles.field}>{field.label}<input type="number" inputMode="decimal" min={field.key==="peak"?.01:0} max={field.max} step="any" required={field.key==="peak"&&inputs.kind!=="ICE"} disabled={inputs.kind==="ICE"||busy} value={inputs[field.key]} placeholder={field.placeholder} onChange={event=>edit(field.key,event.target.value)}/><small>{sources[field.key]|| (field.key==="peak"?"Нужна мощность именно электромоторов":"Необязательно")}</small></label>)}</div>
    {inputs.kind!=="ICE"&&<><h2 className={styles.subheading}>Тепловая модель на 30 минут</h2><p className={styles.intro}>Все величины должны относиться к одному приводу и одному рабочему режиму. Значения ниже не угадываются по названию автомобиля.</p><div className={styles.grid}>{thermalFields.map(field=><label key={field.key} className={styles.field}>{field.label}<input type="number" inputMode="decimal" min={field.min} max={field.max} step="any" value={thermal[field.key]} placeholder="Нет данных" onChange={event=>{setThermal(old=>({...old,[field.key]:event.target.value}));setEstimate(null);setError("");}}/></label>)}</div>
    {inputs.kind==="BEV"&&<label className={styles.field}>Доступная энергия батареи на этот интервал, кВт·ч<input type="number" min="0.01" max="1000" step="any" value={thermal.usableEnergy} placeholder="Необязательно" onChange={event=>{setThermal(old=>({...old,usableEnergy:event.target.value}));setEstimate(null);}}/><small>С учётом начального заряда, резерва и вспомогательных потребителей. Номинальная ёмкость не подставляется автоматически. Это отдельная проверка длительности движения, не мощность мотора по ООН №85.</small></label>}
    {missing.length>0&&<p className={styles.notice} role="status">Для теплового расчёта не хватает: {missing.join(", ")}. Эти данные обычно нужны из испытаний или документации привода.</p>}</>}
    {inputs.kind==="ICE"?<p className={styles.notice}>Для ДВС без тягового электромотора этот показатель не применяется.</p>:<button className={styles.calculate} disabled={busy} type="submit">Рассчитать тепловой сценарий</button>}
   </form>
   {car?.notes.map((note,i)=><p className={styles.notice} key={i}>{note}</p>)}
   <div aria-live="polite">{estimate&&<section className={styles.result}><span>Экспериментальная тепловая модель · не сертифицированная мощность</span><strong>≈ {format(estimate.kw)} кВт</strong><p>≈ {format(estimate.hp)} л.с. · ограничение: {estimate.limiting}</p><dl className={styles.specs}>{estimate.limits.map(item=><div key={item.label}><dt>{item.label}</dt><dd>{format(item.kw)} кВт</dd></div>)}</dl><p>Температура через 30 минут: {format(estimate.endTemperature)} °C. Тепловые потери: {format(estimate.lossKw)} кВт.</p>{estimate.vehicleKw!==undefined&&<p>С учётом введённой доступной энергии батареи: не более {format(estimate.vehicleKw)} кВт в течение получаса. Это отдельное ограничение автомобиля.</p>}{car?.reported&&<p>Разница с ориентиром владельца: {format(estimate.kw-car.reported.kw)} кВт. Совпадение само по себе не подтверждает модель.</p>}</section>}</div>
   <p className={styles.disclaimer}>Для утильсбора и таможни нужны подтверждённые данные конкретной модификации. Значение владельца и тепловой сценарий не переносятся в расчёт стоимости.</p>
   <details className={styles.method}><summary>Физика модели, ограничения и источники</summary><p>Старая формула с фиксированными коэффициентами BEV/HEV и поправками ±0,05 по напряжению удалена. Максимальный момент и максимальные обороты нельзя перемножать как величины одного рабочего режима.</p><p>Используется упрощённый тепловой баланс: C × dT/dt = Pпотерь − (T − Tохл) / R. Постоянные R, C и КПД должны описывать один эквивалентный привод. При t = 1800 с максимальные потери определяются допустимой температурой; Pмех = Pпотерь × η / (1 − η).</p><p>Итог сценария — минимум из теплового предела, U × I × η, лимита контроллера и пиковой мощности. Температура охлаждения и КПД приняты постоянными на весь интервал. Вспомогательные потери должны быть учтены в эквивалентном КПД и доступной энергии.</p><p>Для точной модели нужны карта потерь по оборотам и моменту, сопротивление обмоток и его изменение с температурой, тепловые связи ротора/статора/инвертора, расход и температура охлаждающей жидкости, ограничения токов и прошивки, начальное тепловое состояние. Для нескольких моторов нужны данные каждого и общие ограничения питания. Одна тепловая масса не заменяет такую модель.</p><p>Испытание по ООН №85 определяет мощность привода в заданных условиях. Ограничение батареи автомобиля может отличаться от результата испытаний привода: энергия батареи здесь показана отдельно.</p><a href="https://unece.org/transport/vehicle-regulations-wp29/standards/addenda-1958-agreement-regulations-81-100" target="_blank" rel="noreferrer">Правила ООН №85 ↗</a><br/><a href="https://arxiv.org/abs/2111.07711" target="_blank" rel="noreferrer">Исследование тепловых ограничений электропривода ↗</a><br/><a href="https://www.changan.co.th/images/nevo/q05/pdf/Q05-Specs-sheet-en.pdf" target="_blank" rel="noreferrer">Спецификация Changan Q05 для Таиланда: 120 кВт / 190 Н·м, без 30-минутного значения ↗</a></details>
  </section></div>
 </div></main>;
}
