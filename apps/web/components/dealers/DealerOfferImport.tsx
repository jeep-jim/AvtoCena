'use client';
import {useDealerDemo} from './DealerDemoContext';
import {useEffect,useRef,useState} from 'react';
import type {SourceDraft} from '@/lib/autocalc/load';
import type {SpecialOffer,DealerPhoto} from '@/lib/dealers/showcase-model';
import {importedOffer,applyImportedOffer,importLabels} from '@/lib/dealers/import-offer';
import {button,input} from './DealerEditorFields';
export function DealerOfferImport({dealerId,offer,onChange}:{dealerId:string;offer:SpecialOffer;onChange:(patch:Partial<SpecialOffer>)=>void}){
 const demo=useDealerDemo();
 const [url,setUrl]=useState(offer.sourceUrl||''),[data,setData]=useState<SourceDraft|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[replace,setReplace]=useState(false),[selected,setSelected]=useState<string[]>([]);
 const current=useRef(offer);current.current=offer;
 const controller=useRef<AbortController|null>(null);
 useEffect(()=>()=>controller.current?.abort(),[]);
 async function extract(){
  if(demo){setMessage("В демо добавьте характеристики и фотографии вручную. Импорт доступен в рабочем кабинете.");return;}
  controller.current?.abort();const c=new AbortController();controller.current=c;
  setBusy(true);setMessage('');setData(null);
  try{const r=await fetch('/api/autocalc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'extract',url}),signal:c.signal});const result=await r.json();if(!r.ok)throw Error(result.error||'Не удалось загрузить объявление');if(c.signal.aborted)return;setData(result);setSelected([...new Set<string>(result.images||[])].slice(0,Math.max(0,40-current.current.photos.length)));}
  catch(e){if(!c.signal.aborted)setMessage(e instanceof Error?e.message:'Не удалось загрузить объявление');}finally{if(!c.signal.aborted)setBusy(false);}
 }
 async function apply(){
  if(!data)return;const c=new AbortController();controller.current=c;setBusy(true);
  const fields=applyImportedOffer(current.current,importedOffer(data),replace);
  onChange({...fields,sourceUrl:data.url});
  const photos:DealerPhoto[]=[];let failed=0;
  try{
   for(const [i,url] of selected.slice(0,Math.max(0,40-current.current.photos.length)).entries()){
    setMessage(`Загружаем фото ${i+1} из ${selected.length}…`);
    try{const body=new FormData();body.set('url',url);const r=await fetch(`/api/crm/dealers/${dealerId}/media`,{method:'POST',body,signal:c.signal});const p=await r.json();if(!r.ok)throw Error(p.error);photos.push(p);}
    catch{if(c.signal.aborted)return;failed++;}
   }
   if(c.signal.aborted)return;
   // Keep edits made while photos were loading; failed photos never discard successful uploads.
   onChange({photos:[...current.current.photos,...photos].slice(0,40)});
   setSelected([]);
   setMessage(`Подставлено полей: ${Object.keys(fields).length}. Загружено фото: ${photos.length}.${failed?` Не удалось загрузить ${failed}: добавьте их вручную.`:''} Проверьте карточку автомобиля и заполните недостающие поля.`);
  }finally{if(!c.signal.aborted)setBusy(false);}
 }
 const patch=data?importedOffer(data):{};
 const entries=Object.entries(patch);
 return <section className="space-y-3 rounded-2xl bg-[var(--ac-surface-2)] p-4" aria-label="Импорт объявления">
  <h3 className="font-bold">Заполнить по ссылке на автомобиль</h3>
  <p className="text-xs text-[var(--ac-muted)]">Как в АвтоРасчёте: характеристики, цена и фото с сайтов, которые предоставляют данные объявления.</p>
  <div className="flex flex-wrap gap-2"><input className={`${input} flex-1 basis-48`} aria-label="Ссылка на объявление" type="url" placeholder="https://…" value={url} disabled={busy} onChange={e=>setUrl(e.target.value)}/><button className={button} type="button" disabled={busy||!url.trim()} onClick={()=>void extract()}>{busy?'Загружаем…':'Разобрать ссылку'}</button></div>
  {data&&<div className="space-y-3">
   <p className="text-sm">{data.message}</p>
   {data.price&&<p className="text-sm font-bold">Цена в источнике: {Number(data.price).toLocaleString('ru-RU')} {data.currency||'— валюта не указана'}</p>}
   {data.price&&data.currency!=='USD'&&<p className="text-xs text-[var(--ac-muted)]">В предложении нужна закупочная цена в долларах. Укажите её отдельно; цена источника в другой валюте не подставляется.</p>}
   {!!entries.length&&<dl className="grid grid-cols-2 gap-2 text-xs">{entries.map(([k,v])=><div key={k}><dt className="text-[var(--ac-muted)]">{importLabels[k as keyof SpecialOffer]||k}</dt><dd>{({petrol:'Бензин',diesel:'Дизель',electric:'Электро',hybrid:'Гибрид',series_hybrid:'Последовательный гибрид',left:'Левый',right:'Правый'} as Record<string,string>)[String(v)]||String(v)}</dd></div>)}</dl>}
   {data.notes?.map((note,i)=><p className="text-xs text-[var(--ac-muted)]" key={i}>{note}</p>)}
   {!!data.images?.length&&<><p className="text-sm">Выберите фото для загрузки ({selected.length})</p><div className="dealer-import-photos grid grid-cols-3 gap-2 sm:grid-cols-6">{[...new Set(data.images)].slice(0,40).map(src=><label className="relative cursor-pointer" key={src}><img src={src} alt="Фото из объявления" referrerPolicy="no-referrer" loading="lazy" className="aspect-[4/3] w-full rounded-lg object-cover"/><input aria-label="Импортировать фото" type="checkbox" disabled={busy} checked={selected.includes(src)} className="absolute left-2 top-2 h-5 w-5" onChange={e=>setSelected(x=>e.target.checked?[...x,src]:x.filter(v=>v!==src))}/></label>)}</div></>}
   {!!entries.length&&<label className="flex gap-2 text-sm"><input type="checkbox" checked={replace} disabled={busy} onChange={e=>setReplace(e.target.checked)}/>Заменить заполненные поля найденными значениями</label>}
   {(entries.length>0||selected.length>0)&&<button className={button} type="button" disabled={busy} onClick={()=>void apply()}>Подставить данные и выбранные фото</button>}
  </div>}
  {message&&<p role="status" className="text-sm">{message}</p>}
 </section>;
}
