"use client";
import {useDealerDemo,useDealerUploadBusy} from "./DealerDemoContext";
import {useState,useRef} from "react";
import {Check,Upload,ImagePlus,Trash2,ArrowLeft,ArrowRight,Star} from "lucide-react";
import type {DealerPhoto} from "@/lib/dealers/showcase-model";
export const input = "soft-input w-full min-w-0 rounded-xl px-3 py-2 text-sm";
export const button =
  "rounded-xl border border-[var(--ac-border)] px-4 py-2 text-sm font-bold disabled:opacity-40";
export function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string | number;
  onChange: (v: any) => void;
  type?: string;
}) {
  return (
    <label className="grid gap-1 text-sm">
      {label}
      <input
        className={input}
        type={type}
        value={value}
        step={type === "number" ? "any" : undefined}
        onChange={(e) =>
          onChange(type === "number" ? Number(e.target.value) : e.target.value)
        }
      />
    </label>
  );
}
export function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      onClick={() => onChange(!value)}
      className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-[var(--ac-border)] p-3 text-left"
    >
      <span aria-hidden="true" className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${value ? "bg-red-500" : "bg-slate-400/40"}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${value ? "translate-x-6" : "translate-x-1"}`}/></span>
      <span>{label}</span>
    </button>
  );
}
export function Photos({
  dealerId,
  value,
  onChange,
  single = false,
  limit = 40,
}: {
  dealerId: string;
  value: DealerPhoto[];
  onChange: (p: DealerPhoto[]) => void;
  single?: boolean;
  limit?: number;
}) {
  const demo=useDealerDemo(),picker=useRef<HTMLInputElement>(null);
  const [busy,setBusy]=useState(false),[url,setUrl]=useState(''),[error,setError]=useState(''),[progress,setProgress]=useState(''),[drag,setDrag]=useState(false);
  useDealerUploadBusy(busy);
  const latest=useRef(value);latest.current=value;
  async function upload(files?:FileList|null){
   if(files&&!files.length)return;
   if(!single&&value.length+(files?files.length:1)>limit){setError(`В этой галерее до ${limit} фото. Можно добавить ещё: ${Math.max(0,limit-value.length)}.`);return;}
   setBusy(true);setError('');const added:DealerPhoto[]=[];let failures=0;
   const list=files?Array.from(files):[null];
   for(const [i,file] of list.entries()){
    setProgress(`Загрузка ${i+1} из ${list.length}`);
    try{
     if(file&&(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>8*1024*1024))throw Error('Нужны JPG, PNG или WebP до 8 МБ');
     if(demo){if(!file)throw Error('В демо загрузите фото с устройства');added.push({id:crypto.randomUUID(),url:URL.createObjectURL(file),caption:''});continue;}
     const body=new FormData();if(file)body.set('file',file);else body.set('url',url);
     const r=await fetch(`/api/crm/dealers/${dealerId}/media`,{method:'POST',body});const p=await r.json();if(!r.ok)throw Error(p.error||'Не удалось загрузить');added.push(p);
    }catch(e){failures++;setError(e instanceof Error?e.message:'Не удалось загрузить фото');}
   }
   if(added.length)onChange(single?added.slice(-1):[...latest.current,...added]);
   setProgress(`Загружено: ${added.length}${failures?`. Не загружено: ${failures}`:''}`);setBusy(false);setUrl('');if(picker.current)picker.current.value='';
  }
  function move(i:number,to:number){const next=[...value];const [p]=next.splice(i,1);next.splice(to,0,p);onChange(next);}
  return <div className="dealer-photos space-y-3">
   <div className={`dealer-photo-drop ${drag?'is-dragging':''}`} onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);if(!busy)void upload(e.dataTransfer.files);}}>
    <ImagePlus size={26}/><div><strong>{single?'Добавить изображение':'Добавить фотографии'}</strong><p>Перетащите сюда или выберите на устройстве</p></div><button type="button" className={button} disabled={busy} onClick={()=>picker.current?.click()}><Upload size={16}/> Выбрать</button>
    <input ref={picker} aria-label="Загрузить фотографии" type="file" accept="image/jpeg,image/png,image/webp" multiple={!single} hidden disabled={busy} onChange={e=>void upload(e.target.files)}/>
   </div>
   {!!value.length&&<div className={single?'dealer-photo-single':'dealer-photo-grid'}>{value.map((p,i)=><article key={`${p.id}-${i}`} className="dealer-photo-tile">
    <img src={p.url} alt={p.caption||`Фото ${i+1}`}/>{!single&&i===0&&<span className="dealer-cover-label"><Star size={12}/> Обложка</span>}
    <div className="dealer-photo-tools">{!single&&<><button type="button" disabled={busy||i===0} aria-label={`Фото ${i+1} раньше`} onClick={()=>move(i,i-1)}><ArrowLeft size={16}/></button><button type="button" disabled={busy||i===value.length-1} aria-label={`Фото ${i+1} позже`} onClick={()=>move(i,i+1)}><ArrowRight size={16}/></button><button type="button" disabled={busy||i===0} title="Сделать обложкой" aria-label={`Фото ${i+1} сделать обложкой`} onClick={()=>move(i,0)}><Star size={16}/></button></>}
     <button type="button" disabled={busy} aria-label={`Удалить фото ${i+1}`} onClick={()=>onChange(value.filter((_,n)=>n!==i))}><Trash2 size={16}/></button></div>
    {!single&&<input className={input} aria-label={`Подпись фото ${i+1}`} placeholder="Подпись к фото" value={p.caption} onChange={e=>onChange(value.map((x,n)=>n===i?{...x,caption:e.target.value}:x))}/>}
   </article>)}</div>}
   <details><summary className="cursor-pointer text-sm text-[var(--ac-muted)]">Или добавить по ссылке на фото</summary><div className="mt-3 flex gap-2"><input className={input} type="url" aria-label="Ссылка на изображение" placeholder="https://…" value={url} onChange={e=>setUrl(e.target.value)}/><button type="button" className={button} disabled={busy||!url} onClick={()=>void upload()}>Добавить</button></div></details>
   <p className="text-xs text-[var(--ac-muted)]" role="status">{busy?progress:progress||`JPG, PNG, WebP до 8 МБ. ${single?'':`Фото: ${value.length} из ${limit}. Первое фото — обложка.`}`}</p>{error&&<p role="alert" className="text-sm text-red-500">{error}</p>}
  </div>;
}
