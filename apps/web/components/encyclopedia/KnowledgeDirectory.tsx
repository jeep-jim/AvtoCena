'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import {ModelEditor} from './ModelEditor';
import {EncyclopediaPhoto} from './Photo';
import {counted,type ModelSummary,type ModelRecord} from '@/lib/encyclopedia/schema';
type Summary=Omit<ModelSummary,'key'>;
export function ModelWorkspace({model,canEdit,standalone=false}:{model:Summary;canEdit:boolean;standalone?:boolean}){
 const params=useSearchParams(),filterYear=params.get('year');
 const years=[...model.years].sort((a,b)=>b-a).map(String);if(model.hasUnknownYear||!years.length)years.push('unknown');
 const [year,setYear]=useState(filterYear&&years.includes(filterYear)?filterYear:years[0]);
 const [editing,setEditing]=useState(false);
 useEffect(()=>{if(filterYear&&model.years.includes(Number(filterYear)))setYear(filterYear);},[filterYear,model.id]);
 const [record,setRecord]=useState<ModelRecord|null>(null),[error,setError]=useState('');
 const controller=useRef<AbortController>();
 const load=useCallback(async()=>{
  controller.current?.abort();const request=new AbortController();controller.current=request;setError('');
  try{const response=await fetch(`/api/encyclopedia/${model.id}?year=${year}`,{signal:request.signal});if(!response.ok)throw Error();const data=await response.json();if(!request.signal.aborted)setRecord(data);}
  catch(e){if(!request.signal.aborted){setError('Не удалось загрузить модификации.');throw e;}}
 },[model.id,year]);
 useEffect(()=>{setRecord(null);void load().catch(()=>{});return()=>controller.current?.abort();},[load]);
 return <section className="ac-knowledge-workspace" aria-label={`${model.make} ${model.model}: модификации`}>
  <div className="ac-knowledge-workspace-bar"><div className="ac-knowledge-years" role="group" aria-label={`Год ${model.model}`}>{years.map(y=><button key={y} aria-pressed={year===y} disabled={editing} onClick={()=>setYear(y)}>{y==='unknown'?'Без года':y}</button>)}</div></div>
  {error?<p role="alert">{error} <button className="ac-ency-button" onClick={()=>void load().catch(()=>{})}>Повторить</button></p>:record?<ModelEditor record={record} canEdit={canEdit} defaultYear={year==='unknown'?undefined:Number(year)} onSaved={load} onEditingChange={setEditing} filterFuel={params.get('fuel')||''} onlyMissing30={params.has('missing30')}/>:<p className="ac-ency-muted" role="status">Загружаем модификации…</p>}
 </section>;
}
function ModelRow({model,canEdit}:{model:Summary;canEdit:boolean}){
 const params=useSearchParams(),[open,setOpen]=useState(false);
 const specs=(params.get('year')?model.compact?.years[params.get('year')!]:model.compact?.all)||{};
 return <article className="ac-model-list-item">
  <div className="ac-model-list-row">
   <div className="ac-model-list-photo"><EncyclopediaPhoto src={model.photo} alt={`${model.make} ${model.model}`}/></div>
   <div><strong>{model.make} {model.model}</strong><small>{model.years.length?`${Math.min(...model.years)}–${Math.max(...model.years)}`:'Год не указан'}</small></div>
   <div data-label="Кузов">{specs.bodyType||'—'}<small>{specs.chassisCode||'—'}</small></div>
   <div data-label="Двигатель">{specs.fuel||'—'}<small>{specs.engineCc||'—'} см³ · {specs.powerHp||'—'} л.с.</small></div>
   <div data-label="Привод / КПП">{specs.drive||'—'}<small>{specs.transmission||'—'}</small></div>
   <div data-label="30 мин., кВт">{specs.power30MinKw||'—'}</div>
   <div data-label="В каталоге" title={model.directorySnapshot?`Снимок каталога: ${new Date(model.directorySnapshot.capturedAt).toLocaleString('ru-RU')}`:'Количество ещё не проверено'}>{model.directorySnapshot?.count===undefined?'—':`${model.directorySnapshot.upperBound?'до ':''}${model.directorySnapshot.count.toLocaleString('ru-RU')}`}</div>
   <button className="ac-ency-button" aria-expanded={open} onClick={()=>setOpen(!open)}>{open?'Свернуть':canEdit?'Изменить':'Параметры'}</button>
  </div>
  {open&&<ModelWorkspace model={model} canEdit={canEdit}/>}
 </article>;
}
export function KnowledgeDirectory({models,canEdit,pagination}:{models:Summary[];canEdit:boolean;pagination?:{page:number;total:number}}){
 const params=useSearchParams(),router=useRouter();
 const [page,setPage]=useState(1);
 useEffect(()=>{setPage(1);},[params]);
 const ordered=useMemo(()=>[...models].sort((a,b)=>`${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`,'ru',{numeric:true})),[models]);
 const total=pagination?.total??ordered.length,pages=Math.max(1,Math.ceil(total/40)),current=Math.min(pagination?.page??page,pages);
 const changePage=(next:number)=>{if(pagination){const query=new URLSearchParams(params);query.set("page",String(next));router.push(`/cars/autocatalog?${query}`,{scroll:false});}else setPage(next);};
 return <section className="ac-model-list" aria-label="Модели автомобилей">
  <div className="ac-model-list-head" aria-hidden="true"><span>Фото</span><span>Марка / модель / год</span><span>Кузов / код</span><span>Двигатель</span><span>Привод / КПП</span><span>30 мин., кВт</span><span>В каталоге*</span><span/></div>
  {(pagination?ordered:ordered.slice((current-1)*40,current*40)).map(model=><ModelRow key={model.id} model={model} canEdit={canEdit}/>)}
  {!models.length&&<p>По выбранным параметрам моделей не найдено.</p>}
  <p className="ac-ency-muted">* Количество на дату сохранённого снимка. Дата — при наведении на число.</p>
  {pages>1&&<nav className="ac-ency-pagination" aria-label="Страницы моделей"><button className="ac-ency-button" disabled={current===1} onClick={()=>changePage(current-1)}>Назад</button><span>{current} / {pages} · {counted(total,'model')}</span><button className="ac-ency-button" disabled={current===pages} onClick={()=>changePage(current+1)}>Далее</button></nav>}
 </section>;
}
