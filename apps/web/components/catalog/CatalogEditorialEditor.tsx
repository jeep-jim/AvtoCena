"use client";
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import Link from 'next/link';
import './catalog-editorial-editor.css';
import {PublicSheet} from '@/components/ui/PublicSheet';
import {preparePhotoUpload,readPhotoUploadResponse} from '@/lib/dealers/photo-upload';
import type {CatalogEditorialEntry,EditorialStatus} from '@/lib/catalog/editorial';
import {editorialSpecificationOptions,type EditorialSpecifications} from '@/lib/catalog/editorial-specifications';

export function CatalogEditorialEditor({offerId,originalTitle,initial=null,available=true,sourcePhotos=[],sourceSpecifications={}}:{offerId:string;originalTitle:string;sourcePhotos?:string[];sourceSpecifications?:EditorialSpecifications;initial?:CatalogEditorialEntry|null;available?:boolean}){
 const router=useRouter(),file=useRef<HTMLInputElement>(null),trigger=useRef<HTMLButtonElement>(null);
 const [entry,setEntry]=useState(initial),[open,setOpen]=useState(false),[title,setTitle]=useState(initial?.title||''),[photos,setPhotos]=useState<string[]|null>(initial?.photos||null),[status,setStatus]=useState<EditorialStatus>(initial?.status||'visible'),[reason,setReason]=useState(initial?.reason||''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [closing,setClosing]=useState(false),timer=useRef<ReturnType<typeof setTimeout>|null>(null),drag=useRef<number|null>(null);
 const [specifications,setSpecifications]=useState<EditorialSpecifications>(initial?.specifications||{});
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);},[]);
 const gallery=photos??sourcePhotos.slice(0,30);
 function move(from:number,to:number){if(busy||from===to||to<0||to>=gallery.length)return;const next=[...gallery];next.splice(to,0,next.splice(from,1)[0]);setPhotos(next);}
 function begin(){setTitle(entry?.title||'');setPhotos(entry?.photos||null);setStatus(entry?.status||'visible');setReason(entry?.reason||'');setSpecifications(entry?.specifications||{});setError('');setOpen(true);}
 function close(force=false){if((busy&&!force)||closing)return;setClosing(true);timer.current=setTimeout(()=>{setOpen(false);setClosing(false);trigger.current?.focus();},180);}
 async function upload(files:FileList|null){
  if(!files?.length)return;
  setBusy(true);setError('');
  try{
   if(files.length>30)throw Error('Выберите до 30 фотографий.');
   const urls:string[]=[];
   for(const source of Array.from(files)){
    const prepared=await preparePhotoUpload(source),form=new FormData();form.set('file',prepared);
    const response=await readPhotoUploadResponse(await fetch('/api/crm/catalog/photos',{method:'POST',body:form}));urls.push(response.url);
   }
   setPhotos(urls);
  }catch(e){setError(e instanceof Error?e.message:'Не удалось загрузить фотографии.');}
  finally{setBusy(false);if(file.current)file.current.value='';}
 }
 async function save(){
  if(busy||closing)return;
  setBusy(true);setError('');
  try{
   const response=await fetch(`/api/catalog/offer/${encodeURIComponent(offerId)}/editorial`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,photos,status,reason,specifications,version:entry?.version||null})});
   const data=await response.json();if(!response.ok)throw Error(data.error||'Не удалось сохранить.');
   setEntry(data.entry);close(true);
   if(status!=='visible')router.push(`/crm/catalog?status=${status}`);
   router.refresh();
  }catch(e){setError(e instanceof Error?e.message:'Не удалось подтвердить сохранение. Обновите страницу.');}
  finally{setBusy(false);}
 }
 const button='rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface-2)] px-3 py-2 text-sm font-bold disabled:opacity-50';
 return <div className="absolute inset-0 z-20 pointer-events-none">
  {<button ref={trigger} type="button" onClick={begin} className="ac-catalog-editor-trigger pointer-events-auto absolute right-3 top-3 rounded-xl bg-black/80 px-3 py-2 text-sm font-bold text-white">Редактировать объявление</button>}
  {open&&<PublicSheet title="Редактирование объявления" onClose={()=>close()} maxWidth={800} className={`ac-catalog-editor-sheet pointer-events-auto ${closing?'ac-catalog-editor-closing':''}`}>
  <form aria-label="Редактирование объявления" onSubmit={e=>{e.preventDefault();void save();}} className="ac-catalog-editor-form p-5">
   <p className="mt-2 text-xs text-[var(--ac-muted)]">Правки будут видны всем и сохранятся при обновлении объявлений. Год, объём, мощность и топливо меняются в блоке параметров автомобиля.</p>
   <label className="mt-3 block text-sm font-bold">Название<input value={title} maxLength={200} placeholder={originalTitle} onChange={e=>setTitle(e.target.value)} disabled={busy} className="mt-1 w-full rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface-2)] p-2 font-normal"/></label>
   <p className="mt-1 text-xs text-[var(--ac-muted)]">Пустое поле — название продавца.</p>
   <fieldset className="mt-4" disabled={busy}><legend className="text-sm font-bold">Характеристики объявления</legend>
    <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">{(['bodyType','drive','transmission'] as const).map(key=><label key={key} className="block text-sm font-bold">{{bodyType:'Кузов',drive:'Привод',transmission:'Коробка передач'}[key]}<select value={specifications[key]||''} onChange={e=>setSpecifications(current=>({...current,[key]:e.target.value}))} className="mt-1 block w-full rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface-2)] p-2 font-normal"><option value="">Данные продавца{sourceSpecifications[key]?` · ${editorialSpecificationOptions[key].find(option=>option[0]===sourceSpecifications[key])?.[1]||sourceSpecifications[key]}`:''}</option>{editorialSpecificationOptions[key].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>)}
    <label className="block text-sm font-bold">Цвет<input value={specifications.color||''} maxLength={60} placeholder={sourceSpecifications.color||'Данные продавца'} onChange={e=>setSpecifications(current=>({...current,color:e.target.value}))} className="mt-1 w-full rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface-2)] p-2 font-normal"/></label></div>
    <p className="mt-2 text-xs text-[var(--ac-muted)]">Чтобы отменить правку, выберите «Данные продавца» или очистите цвет.</p>
   </fieldset>
   <div className="mt-3 flex flex-wrap gap-2">{typeof document!=="undefined"&&document.getElementById("offer-parameters")&&<button type="button" className={button} disabled={busy} onClick={()=>{close();setTimeout(()=>document.getElementById("offer-parameters")?.scrollIntoView({behavior:"smooth",block:"start"}),190);}}>Изменить параметры</button>}<button type="button" className={button} disabled={busy} onClick={()=>file.current?.click()}>Заменить фото</button><button type="button" className={button} disabled={busy||!photos} onClick={()=>setPhotos(null)}>Вернуть фото продавца</button><Link className={button} href="/crm/catalog">Перейти в архив</Link></div>
   <input hidden ref={file} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e=>void upload(e.target.files)}/>
   {gallery.length>0&&<><p className="mt-4 text-sm font-bold">Фотографии · {gallery.length}</p><p className="mt-1 text-xs text-[var(--ac-muted)]">Выберите обложку галочкой. Меняйте порядок стрелками или перетаскиванием.</p><div className="ac-editor-photos mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{gallery.map((url,i)=><div key={url+i} draggable={!busy} onDragStart={()=>{drag.current=i;}} onDragEnd={()=>{drag.current=null;}} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(drag.current!==null)move(drag.current,i);drag.current=null;}} className={`min-w-0 overflow-hidden rounded-xl border-2 ${i===0?'border-orange-500':'border-[var(--ac-border)]'}`}>
    <button type="button" disabled={busy} aria-pressed={i===0} aria-label={`Сделать фото ${i+1} обложкой`} onClick={()=>move(i,0)} className="relative block w-full"><img draggable={false} src={url} alt={`Фото ${i+1}`} className="aspect-[4/3] w-full object-cover"/><span className="ac-editor-cover absolute bottom-1 left-1 rounded-lg px-2 py-1 text-xs font-bold">{i===0?'✓ Обложка':'○ Обложка'}</span></button>
    <div className="flex items-center justify-between gap-1 p-1"><button type="button" className={button} disabled={busy||i===0} aria-label={`Переместить фото ${i+1} влево`} onClick={()=>move(i,i-1)}>←</button><span className="text-xs">{i+1}</span><button type="button" className={button} disabled={busy||i===gallery.length-1} aria-label={`Переместить фото ${i+1} вправо`} onClick={()=>move(i,i+1)}>→</button></div>
   </div>)}</div></>}
   <label className="mt-3 block text-sm font-bold">Показ объявления<select aria-label="Показ объявления" value={status} disabled={busy} onChange={e=>setStatus(e.target.value as EditorialStatus)} className="mt-1 block w-full rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface-2)] p-2"><option value="visible" disabled={!available}>Показывать на сайте</option><option value="hidden">Скрыть объявление</option><option value="archived">Отправить в архив</option></select></label>
   {!available&&<p className="mt-1 text-xs">Объявление уже недоступно у продавца. Вернуть его на сайт пока нельзя.</p>}
   <label className="mt-3 block text-sm font-bold">Комментарий для команды<textarea value={reason} maxLength={500} disabled={busy} onChange={e=>setReason(e.target.value)} placeholder="Например: на фото другой автомобиль" className="mt-1 w-full rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface-2)] p-2 font-normal" rows={2}/></label>
   {error&&<p role="alert" className="mt-2 text-sm text-red-500">{error}</p>}
   <div className="ac-catalog-editor-actions mt-3 flex flex-wrap gap-2"><button disabled={busy} className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-black text-black disabled:opacity-50">{busy?'Сохраняем…':'Сохранить изменения'}</button><button type="button" disabled={busy} onClick={()=>close()} className={button}>Отмена</button></div>
  </form></PublicSheet>}
 </div>;
}
