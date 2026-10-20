"use client";
import {useEffect,useRef,useState} from "react";
import {emptyPower30Inputs,estimatePower30,type Power30Car,type Power30Inputs,type Power30Kind} from "../../lib/power30/calculator";
import styles from "./Power30Page.module.css";
const kinds:Record<Power30Kind,string>={unknown:"Уточните тип автомобиля",BEV:"Электромобиль (BEV)",PHEV:"Подключаемый / последовательный гибрид",HEV:"Обычный гибрид (HEV)",MHEV:"Мягкий гибрид (MHEV)",ICE:"ДВС без тягового электромотора"};
const fields=[{key:"peak",label:"Пиковая мощность электромоторов, кВт",placeholder:"Например, 150",max:2000},{key:"torque",label:"Крутящий момент электромоторов, Н·м",placeholder:"Если известен",max:20000},{key:"rpm",label:"Максимальные обороты, об/мин",placeholder:"Если известны",max:100000},{key:"voltage",label:"Напряжение тяговой батареи, В",placeholder:"Если известно",max:2000}] as const;
const format=(n:number)=>n.toLocaleString("ru-RU",{maximumFractionDigits:2});
export function Power30Page(){
 const [url,setUrl]=useState("");const [car,setCar]=useState<Power30Car|null>(null);
 const [inputs,setInputs]=useState<Power30Inputs>({...emptyPower30Inputs});
 const [sources,setSources]=useState<Power30Car["inputSources"]>({});
 const [estimate,setEstimate]=useState<ReturnType<typeof estimatePower30>|null>(null);
 const [error,setError]=useState("");const [busy,setBusy]=useState(false);const [photoFailed,setPhotoFailed]=useState(false);
 const active=useRef<AbortController|null>(null);const generation=useRef(0);
 useEffect(()=>()=>{generation.current++;active.current?.abort();},[]);
 function clear(){generation.current++;active.current?.abort();setCar(null);setEstimate(null);setInputs({...emptyPower30Inputs});setSources({});setPhotoFailed(false);setError("");setBusy(false);}
 async function load(value:string){
  clear();const sequence=generation.current;const controller=new AbortController();active.current=controller;setBusy(true);
  const timer=setTimeout(()=>controller.abort(),25000);
  try{
   const response=await fetch(`/api/power30?${new URLSearchParams({url:value})}`,{signal:controller.signal,cache:"no-store"});
   const data=await response.json();if(sequence!==generation.current)return;
   if(!response.ok)throw new Error(data.error || "Не удалось загрузить автомобиль.");
   const next=data as Power30Car;setCar(next);setInputs(next.inputs);setSources(next.inputSources);
   if(next.inputs.peak && !["ICE","unknown"].includes(next.inputs.kind))setEstimate(estimatePower30(next.inputs));
  }catch(e){if(sequence===generation.current)setError(controller.signal.aborted?"Загрузка заняла слишком много времени. Повторите попытку.":e instanceof Error?e.message:"Не удалось загрузить автомобиль.");}
  finally{clearTimeout(timer);if(sequence===generation.current)setBusy(false);}
 }
 function edit(key:keyof Power30Inputs,value:string){setInputs(old=>({...old,[key]:value}));setSources(old=>({...old,[key]:"Введено вручную"}));setEstimate(null);setError("");}
 return <main className={styles.page}><div className={styles.wrap}>
  <div className={styles.top}><a href="/cars">АвтоЦена</a><span>Экспериментальный расчёт</span></div>
  <div className={styles.photo} aria-busy={busy}>
   {car?.image&&!photoFailed?<img src={car.image} alt={car.title} onError={()=>setPhotoFailed(true)}/>:<div><span className={styles.symbol}>⚡</span><p>{busy?"Загружаем автомобиль…":car?"Фото недоступно":"Фото автомобиля появится здесь"}</p></div>}
  </div>
  {car&&<a className={styles.carTitle} href={car.href} target="_blank" rel="noreferrer">{car.title} ↗</a>}
  <form className={styles.linkForm} onSubmit={event=>{event.preventDefault();void load(url);}}>
   <label htmlFor="power30-url">Ссылка на автомобиль с АвтоЦены</label>
   <div><input id="power30-url" type="url" required value={url} placeholder="https://avtocena.com/cars/offer/…" onChange={event=>{clear();setUrl(event.target.value);}} onPaste={event=>{const value=event.clipboardData.getData("text").trim();if(/^https?:\/\//i.test(value)){event.preventDefault();setUrl(value);void load(value);}}}/><button disabled={busy} type="submit">{busy?"Загрузка…":"Загрузить"}</button></div>
  </form>
  {error&&<p role="alert" className={styles.error}>{error}</p>}
  <section className={styles.panel}>
   <h1>Расчёт 30-мин мощности</h1><p className={styles.intro}>Вставьте ссылку — доступные параметры заполнятся автоматически. Их можно уточнить вручную.</p>
   {car?.certified&&<div className={styles.certified}><span>30-минутная мощность по данным автомобиля</span><strong>{format(car.certified.kw)} кВт <small> / {format(car.certified.kw*1.35962)} л.с.</small></strong><p>Источник: {car.certified.source}</p>{car.certified.url&&<a href={car.certified.url} target="_blank" rel="noreferrer">Открыть документ ↗</a>}<p>Значение относится к загруженной карточке и не меняется при редактировании экспериментального расчёта.</p></div>}
   <form onSubmit={event=>{event.preventDefault();try{setEstimate(estimatePower30(inputs));setError("");}catch(e){setEstimate(null);setError((e as Error).message);}}}>
    <label className={styles.field}>Тип автомобиля<select value={inputs.kind} onChange={event=>edit("kind",event.target.value)}>{Object.entries(kinds).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><small>{sources.kind||"Выберите тип силовой установки"}</small></label>
    <div className={styles.grid}>{fields.map(field=><label key={field.key} className={styles.field}>{field.label}<input type="number" inputMode="decimal" min={field.key==="peak"?.01:0} max={field.max} step="any" required={field.key==="peak"&&inputs.kind!=="ICE"} disabled={inputs.kind==="ICE"||busy} value={inputs[field.key]} placeholder={field.placeholder} onChange={event=>edit(field.key,event.target.value)}/><small>{sources[field.key]|| (field.key==="peak"?"Нужна мощность именно электромоторов":"Необязательно")}</small></label>)}</div>
    {inputs.kind==="ICE"?<p className={styles.notice}>Для ДВС без тягового электромотора этот показатель не применяется.</p>:<button className={styles.calculate} disabled={busy} type="submit">Рассчитать оценку</button>}
   </form>
   {car?.notes.map((note,i)=><p className={styles.notice} key={i}>{note}</p>)}
   <div aria-live="polite">{estimate&&<section className={styles.result}><span>Экспериментальная оценка · не подтверждённая мощность</span><strong>≈ {format(estimate.kw)} кВт</strong><p>≈ {format(estimate.hp)} л.с.</p><p>{inputs.peak} кВт × {format(estimate.ratio)} = {format(estimate.kw)} кВт</p></section>}</div>
   <p className={styles.disclaimer}>Это проверка формулы, а не измерение мощности. Для утильсбора и таможни нужны подтверждённые данные конкретной модификации. Оценка не переносится в расчёт стоимости автомобиля.</p>
   <details className={styles.method}><summary>Как получена оценка и где взять точное значение</summary><p>Базовый коэффициент из исходного калькулятора: BEV — 0,75; PHEV — 0,65; HEV — 0,50; MHEV — 0,20 при мощности менее 10 кВт, иначе 0,40. Это экспериментальные допущения, не нормативные коэффициенты.</p><p>Если момент × обороты / 9549 меньше 80% пиковой мощности, коэффициент умножается на 0,85. При напряжении от 400 В добавляется 0,05; ниже 200 В вычитается 0,05. Неизвестные поля не участвуют в поправках. Итоговый коэффициент ограничен диапазоном 0,10–0,90.</p><p>Пиковый момент и максимальные обороты могут относиться к разным режимам. Эти четыре параметра не позволяют достоверно определить мощность, поддерживаемую 30 минут.</p><p>Точное значение ищут в документах на конкретную модификацию: ОТТС, СБКТС, ЭПТС, CoC или протоколе испытаний по Правилам ООН №85. Страница проверяет имеющиеся параметры объявления и справочник подтверждённых мощностей. Если записи нет, это не означает нулевую мощность.</p><a href="https://unece.org/transport/vehicle-regulations-wp29/standards/addenda-1958-agreement-regulations-81-100" target="_blank" rel="noreferrer">Правила ООН №85 ↗</a></details>
  </section>
 </div></main>;
}
