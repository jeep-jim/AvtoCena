"use client";
import {useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import Link from 'next/link';
import {preparePhotoUpload,readPhotoUploadResponse} from '@/lib/dealers/photo-upload';
import type {CatalogEditorialEntry,EditorialStatus} from '@/lib/catalog/editorial';

export function CatalogEditorialEditor({offerId,originalTitle,initial=null,available=true}:{offerId:string;originalTitle:string;initial?:CatalogEditorialEntry|null;available?:boolean}){
 const router=useRouter(),file=useRef<HTMLInputElement>(null),trigger=useRef<HTMLButtonElement>(null);
 const [entry,setEntry]=useState(initial),[open,setOpen]=useState(false),[title,setTitle]=useState(initial?.title||''),[photos,setPhotos]=useState<string[]|null>(initial?.photos||null),[status,setStatus]=useState<EditorialStatus>(initial?.status||'visible'),[reason,setReason]=useState(initial?.reason||''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 function begin(){setTitle(entry?.title||'');setPhotos(entry?.photos||null);setStatus(entry?.status||'visible');setReason(entry?.reason||'');setError('');setOpen(true);}
 function close(){setOpen(false);requestAnimationFrame(()=>trigger.current?.focus());}
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
  setBusy(true);setError('');
  try{
   const response=await fetch(`/api/catalog/offer/${encodeURIComponent(offerId)}/editorial`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,photos,status,reason,version:entry?.version||null})});
   const data=await response.json();if(!response.ok)throw Error(data.error||'Не удалось сохранить.');
   setEntry(data.entry);close();
   if(status!=='visible')router.push(`/crm/catalog?status=${status}`);
   router.refresh();
  }catch(e){setError(e instanceof Error?e.message:'Не удалось подтвердить сохранение. Обновите страницу.');}
  finally{setBusy(false);}
 }
 const button='rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface-2)] px-3 py-2 text-sm font-bold disabled:opacity-50';
 return <div className="absolute inset-0 z-20 pointer-events-none">
  {!open?<button ref={trigger} type="button" onClick={begin} className="ac-catalog-editor-trigger pointer-events-auto absolute right-3 top-3 rounded-xl bg-black/80 px-3 py-2 text-sm font-bold text-white">Редактировать объявление</button>:
  <form aria-label="Редактирование объявления" onSubmit={e=>{e.preventDefault();void save();}} className="ac-catalog-editor-form pointer-events-auto absolute inset-2 overflow-y-auto rounded-2xl border border-[var(--ac-border)] bg-[var(--ac-surface)] p-4 text-[var(--ac-text)] shadow-xl" onKeyDown={e=>{if(e.key==='Escape'&&!busy){e.stopPropagation();close();}}}>
   <div className="flex items-center justify-between gap-2"><h2 className="font-black">Редактирование объявления</h2><button type="button" onClick={close} disabled={busy} aria-label="Отменить редактирование" className={button}>✕</button></div>
   <p className="mt-2 text-xs text-[var(--ac-muted)]">Правки сохранятся при обновлении объявлений. Характеристики и расчёт можно изменить в блоке параметров автомобиля.</p>
   <label className="mt-3 block text-sm font-bold">Название<input autoFocus value={title} maxLength={200} placeholder={originalTitle} onChange={e=>setTitle(e.target.value)} disabled={busy} className="mt-1 w-full rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface-2)] p-2 font-normal"/></label>
   <p className="mt-1 text-xs text-[var(--ac-muted)]">Пустое поле — название продавца.</p>
   <div className="mt-3 flex flex-wrap gap-2">{typeof document!=="undefined"&&document.getElementById("offer-parameters")&&<button type="button" className={button} disabled={busy} onClick={()=>{close();document.getElementById("offer-parameters")?.scrollIntoView({behavior:"smooth",block:"start"});}}>Изменить параметры</button>}<button type="button" className={button} disabled={busy} onClick={()=>file.current?.click()}>Заменить фото</button><button type="button" className={button} disabled={busy||!photos} onClick={()=>setPhotos(null)}>Вернуть фото продавца</button><Link className={button} href="/crm/catalog">Перейти в архив</Link></div>
   <input hidden ref={file} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e=>void upload(e.target.files)}/>
   {photos&&<><p className="mt-2 text-xs">Новая галерея: {photos.length} фото. Первое станет обложкой.</p><div className="mt-2 flex gap-2 overflow-x-auto">{photos.map((url,i)=><button key={url+i} type="button" disabled={busy} title="Сделать обложкой" aria-label={`Сделать фото ${i+1} обложкой`} onClick={()=>setPhotos([url,...photos.filter((_,n)=>n!==i)])} className={`shrink-0 rounded-lg border-2 ${i===0?'border-orange-400':'border-transparent'}`}><img src={url} alt={`Фото ${i+1}`} className="h-12 w-16 rounded-md object-cover"/></button>)}</div></>}
   <label className="mt-3 block text-sm font-bold">Показ объявления<select aria-label="Показ объявления" value={status} disabled={busy} onChange={e=>setStatus(e.target.value as EditorialStatus)} className="mt-1 block w-full rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface-2)] p-2"><option value="visible" disabled={!available}>Показывать на сайте</option><option value="hidden">Скрыть объявление</option><option value="archived">Отправить в архив</option></select></label>
   {!available&&<p className="mt-1 text-xs">Объявление уже недоступно у продавца. Вернуть его на сайт пока нельзя.</p>}
   <label className="mt-3 block text-sm font-bold">Комментарий для команды<textarea value={reason} maxLength={500} disabled={busy} onChange={e=>setReason(e.target.value)} placeholder="Например: на фото другой автомобиль" className="mt-1 w-full rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface-2)] p-2 font-normal" rows={2}/></label>
   {error&&<p role="alert" className="mt-2 text-sm text-red-500">{error}</p>}
   <div className="ac-catalog-editor-actions mt-3 flex flex-wrap gap-2"><button disabled={busy} className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-black text-black disabled:opacity-50">{busy?'Сохраняем…':'Сохранить изменения'}</button><button type="button" disabled={busy} onClick={close} className={button}>Отмена</button></div>
  </form>}
 </div>;
}
