'use client';
import {mechanicalRows} from '@/lib/encyclopedia/compact';
import {Fragment,useEffect,useId,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {Pencil,Plus,X} from 'lucide-react';
import {CatalogChevron} from '@/components/catalog/CatalogChevron';
import {fieldGroups,editorFieldGroups,fieldChoices,filterVariants,astraDetails} from '@/lib/encyclopedia/presentation';
import {type ModelRecord,type Variant,labels,numberFields,displayValue,statusLabels} from '@/lib/encyclopedia/schema';
const pageSize=25;
type Draft={mode:'model'|'variant';value:Record<string,any>;target:string};
function RecordDetails({variant}:{variant:Variant}){
 const official=astraDetails(variant);
 return <div className="ac-ency-record-details">{fieldGroups.map(group=><section key={group.title}><h3>{group.title}</h3><dl>{group.fields.map(field=><div key={field}><dt>{labels[field]}</dt><dd>{displayValue(variant[field])}</dd></div>)}</dl></section>)}{!!official.length&&<section><h3>Одобрение типа</h3><dl>{official.map(row=><div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl></section>}</div>;
}
export function ModelEditor({record,canEdit,onSaved,defaultYear,onEditingChange,filterFuel='',onlyMissing30=false}:{record:ModelRecord;canEdit:boolean;onSaved?:()=>void|Promise<void>;defaultYear?:number;onEditingChange?:(editing:boolean)=>void;filterFuel?:string;onlyMissing30?:boolean}){
 const router=useRouter(),formId=useId(),form=useRef<HTMLFormElement>(null);
 const [draft,setDraft]=useState<Draft|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[syncPending,setSyncPending]=useState(false);
 const [expanded,setExpanded]=useState<Set<string>>(new Set()),[query,setQuery]=useState(''),[filter,setFilter]=useState(''),[page,setPage]=useState(1);
 useEffect(()=>{onEditingChange?.(!!draft);return()=>onEditingChange?.(false);},[!!draft,onEditingChange]);
 useEffect(()=>{setPage(1);},[query,filter,record.id,filterFuel,onlyMissing30]);
 useEffect(()=>{if(!draft)return;form.current?.querySelector<HTMLInputElement>('input')?.focus({preventScroll:true});form.current?.scrollIntoView({block:'nearest'});const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[draft?.target]);
 const open=(variant?:Variant)=>{setDraft({mode:'variant',target:variant?.id||'new',value:variant?{...variant}:{year:defaultYear,markets:[],status:'review'}});setError('');setMessage('');};
 const cancel=()=>{if(!busy){setDraft(null);setError('');}};
 const save=async()=>{
  if(!draft)return;setBusy(true);setError('');
  try{
   const response=await fetch(`/api/encyclopedia/${record.id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:record.revision,action:draft.mode,...(draft.mode==='model'?draft.value:{variant:draft.value})})});
   const data=await response.json();if(!response.ok)throw Error(data.error||'Сохранение не подтверждено.');
   setDraft(null);setSyncPending(data.knowledgeUpdated===false);setMessage(data.knowledgeUpdated===false?'Изменения сохранены. Применить их к похожим автомобилям пока не удалось.':'Изменения сохранены и доступны для расчётов похожих автомобилей.');router.refresh();
   try{await onSaved?.();}catch{setMessage('Изменения сохранены. Обновите список, чтобы увидеть их.');}
  }catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить.');}finally{setBusy(false);}
 };
 const field=(name:string)=>{
  const numeric=(numberFields as readonly string[]).includes(name),choices=fieldChoices[name];
  return <label key={name} className={name==='notes'||name==='sourceUrl'?'ac-ency-field-wide':undefined}>{labels[name]||({make:'Марка',model:'Модель',photo:'Ссылка на фото'} as Record<string,string>)[name]}
   {name==='notes'?<textarea value={draft?.value[name]??''} onChange={e=>setDraft(d=>d&&({...d,value:{...d.value,[name]:e.target.value}}))} rows={3}/>:<input type={numeric?'number':'text'} inputMode={numeric?'decimal':undefined} min={numeric?name==='year'?1900:0:undefined} step={numeric?name==='year'?1:'any':undefined} list={choices?`${formId}-${name}`:undefined} value={draft?.value[name]??''} onChange={e=>setDraft(d=>d&&({...d,value:{...d.value,[name]:e.target.value}}))}/>}
   {choices&&<datalist id={`${formId}-${name}`}>{choices.map(v=><option key={v} value={v}>{displayValue(v)}</option>)}</datalist>}
  </label>;
 };
 const editor=draft&&<form ref={form} className="ac-ency-inline-editor" aria-label={draft.mode==='model'?'Редактирование модели':'Редактирование модификации'} onSubmit={e=>{e.preventDefault();void save();}}>
  <header><h3>{draft.mode==='model'?`${record.make} ${record.model}`:draft.target==='new'?'Новая модификация':`Изменить: ${draft.value.trim||draft.value.chassisCode||'модификация'}${draft.value.year?' · '+draft.value.year:''}`}</h3><button className="ac-ency-button ac-ency-primary" disabled={busy} type="submit">{busy?'Сохраняем…':'Сохранить'}</button><button className="ac-ency-button" type="button" disabled={busy} onClick={cancel}><X size={16} aria-hidden/>Отмена</button></header>
  {error&&<p role="alert" className="ac-ency-error">{error}</p>}
  <fieldset disabled={busy} className="ac-ency-editor-body">{draft.mode==='model'?<div className="ac-ency-fields">{['make','model','photo'].map(field)}</div>:<>{editorFieldGroups.map(group=><fieldset className="ac-ency-field-group" key={group.title}><legend>{group.title}</legend><div className="ac-ency-fields">{group.fields.map(field)}</div></fieldset>)}<label className="ac-ency-verification">Проверка<select value={draft.value.status==='observed'?'review':draft.value.status} onChange={e=>setDraft(d=>d&&({...d,value:{...d.value,status:e.target.value}}))}><option value="review">На проверке</option><option value="verified">Подтверждено источником</option></select></label></>}</fieldset>
 </form>;
 const filtered=filterVariants(mechanicalRows(record.variants),query,filter,{fuel:filterFuel,missing30:onlyMissing30}),pages=Math.max(1,Math.ceil(filtered.length/pageSize)),current=Math.min(page,pages),rows=filtered.slice((current-1)*pageSize,current*pageSize);
 return <section className="ac-ency-model-editor" aria-label="Характеристики и редактирование">
  <div className="ac-ency-record-toolbar"><label className="ac-ency-record-search"><span className="sr-only">Поиск модификации</span><input type="search" placeholder="Код кузова или двигателя" value={query} onChange={e=>setQuery(e.target.value)} disabled={!!draft}/></label><label><span className="sr-only">Проверка модификаций</span><select value={filter} disabled={!!draft} onChange={e=>setFilter(e.target.value)}><option value="">Все варианты двигателя</option><option value="missing30">Без 30-мин. мощности</option><option value="review">Требуют проверки</option><option value="verified">Подтверждённые</option></select></label>{canEdit&&<><button className="ac-ency-button" disabled={!!draft} onClick={()=>{setDraft({mode:'model',target:'model',value:{make:record.make,model:record.model,photo:record.photo}});setError('');setMessage('');}}><Pencil size={15} aria-hidden/>Модель и фото</button><button className="ac-ency-button ac-ency-primary" disabled={!!draft} onClick={()=>open()}><Plus size={16} aria-hidden/>Год и параметры</button></>}</div>
  {message&&<p role="status" className="ac-ency-save-status">{message}</p>}{syncPending&&<button className="ac-ency-button" disabled={busy} onClick={async()=>{setBusy(true);try{const response=await fetch(`/api/encyclopedia/${record.id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'sync'})});const data=await response.json();if(!response.ok||!data.knowledgeUpdated)throw Error();setSyncPending(false);setMessage('Изменения применены.');}catch{setMessage('Применение пока не удалось. Повторите позже.');}finally{setBusy(false);}}}>Повторить применение</button>}
  {draft&&['new','model'].includes(draft.target)&&editor}
  <div className="ac-ency-table-wrap"><table className="ac-ency-table"><caption className="sr-only">Модификации {record.make} {record.model}</caption><thead><tr><th scope="col">Год и параметры</th><th scope="col">Кузов</th><th scope="col">Двигатель</th><th scope="col">Привод · КПП</th><th scope="col">30 мин., кВт</th><th scope="col">Проверка</th></tr></thead><tbody>{rows.map(v=><Fragment key={v.id}><tr className={expanded.has(v.id)||draft?.target===v.id?'ac-ency-row-selected':undefined}>
   <td data-label="Модификация"><button className="ac-ency-row-toggle" aria-expanded={expanded.has(v.id)} aria-controls={`${formId}-${v.id}`} onClick={()=>setExpanded(old=>{const next=new Set(old);if(next.has(v.id))next.delete(v.id);else next.add(v.id);return next;})}><CatalogChevron open={expanded.has(v.id)}/><span><strong>{v.chassisCode||[displayValue(v.fuel),v.engineCc?`${v.engineCc} см³`:'',v.powerHp?`${v.powerHp} л.с.`:''].filter(Boolean).join(' · ')}</strong><small>{v.year||'Без года'}{v.generation?' · '+v.generation:''}</small></span></button></td>
   <td data-label="Кузов">{displayValue(v.bodyType)}<small>{displayValue(v.chassisCode)}</small></td>
   <td data-label="Двигатель">{displayValue(v.fuel)}<small>{v.engineCc?`${v.engineCc} см³`:'—'} · {v.powerHp?`${v.powerHp} л.с.`:'—'}</small></td>
   <td data-label="Привод · КПП">{displayValue(v.drive)}<small>{displayValue(v.transmission)}</small></td>
   <td data-label="30 мин., кВт" className={v.power30MinKw===undefined?'ac-ency-empty':undefined}>{displayValue(v.power30MinKw)}</td>
   <td data-label="Проверка"><span className={`ac-ency-status ac-ency-status--${v.status}`}>{statusLabels[v.status]}</span>{canEdit&&<button className="ac-ency-row-edit" disabled={!!draft} onClick={()=>open(v)} aria-label={`Изменить ${v.trim||v.chassisCode||'модификацию'} ${v.year||''}`}><Pencil size={14} aria-hidden/>Изменить</button>}</td>
  </tr>{(expanded.has(v.id)||draft?.target===v.id)&&<tr className="ac-ency-detail-row"><td colSpan={6} id={`${formId}-${v.id}`}>{draft?.target===v.id?editor:<RecordDetails variant={v}/>}</td></tr>}</Fragment>)}</tbody></table></div>
  {!rows.length&&<p className="ac-ency-muted">{record.variants.length?'Модификации не найдены.':'Модификации ещё не добавлены.'}</p>}
  {pages>1&&<nav className="ac-ency-pagination" aria-label="Страницы таблицы"><button className="ac-ency-button" disabled={current===1||!!draft} onClick={()=>setPage(current-1)}>Назад</button><span>{current} / {pages} · {filtered.length} модификаций</span><button className="ac-ency-button" disabled={current===pages||!!draft} onClick={()=>setPage(current+1)}>Далее</button></nav>}
 </section>;
}
