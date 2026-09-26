"use client";
import {lazy,Suspense,useEffect,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import type {ClientDocument} from "@/lib/client-documents";
const PdfPreview=lazy(()=>import("../catalog/OfferPdfPreview"));
export function ClientDocuments({clientId,documents}:{clientId:string;documents:ClientDocument[]}) {
 const router=useRouter(),dialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLInputElement>(null);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState(""),[preview,setPreview]=useState<ClientDocument|null>(null);
 const deepOpened=useRef("");
 useEffect(()=>{const id=new URLSearchParams(window.location.search).get("document");if(!id||deepOpened.current===id)return;const doc=documents.find(d=>d.id===id);if(doc){deepOpened.current=id;if(doc.hasThumbnail||doc.mime==="application/pdf")void openDocument(doc);document.getElementById(`document-${id}`)?.scrollIntoView({block:"center"});}},[documents]);
 const [pdf,setPdf]=useState<{blob:Blob;name:string}|null>(null),[opening,setOpening]=useState(false);
 const url=(doc:ClientDocument)=>`/api/crm/clients/${encodeURIComponent(clientId)}/documents/${doc.id}`;
 useEffect(()=>{if(preview)dialog.current?.showModal();},[preview]);
 async function openDocument(doc:ClientDocument) {
  if(doc.mime!=="application/pdf"){setPreview(doc);return;}
  setOpening(true);setError("");
  try{const response=await fetch(url(doc),{cache:"no-store"});if(!response.ok)throw Error("Не удалось открыть документ. Проверьте доступ и повторите попытку.");setPdf({blob:await response.blob(),name:doc.name});}
  catch(e){setError(e instanceof Error?e.message:"Не удалось открыть документ.");}
  finally{setOpening(false);}
 }
 async function trash(doc:ClientDocument) {
  if(!window.confirm(`Удалить «${doc.name}»? Даже если это договор, его можно будет восстановить: файл попадёт в корзину в «Архиве» на 30 дней, затем удалится автоматически. Переместить в корзину?`))return;
  setBusy(true);setError("");setMessage("");
  try{const response=await fetch(url(doc),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"trash",confirmed:true})});if(!response.ok)throw Error("Не удалось переместить документ в корзину. Повторите попытку.");setMessage("Документ в корзине. Восстановить его можно в разделе «Архив».");router.refresh();}
  catch(e){setError(e instanceof Error?e.message:"Не удалось удалить документ.");}finally{setBusy(false);}
 }
 async function upload(files:FileList|null) {
  if(!files?.length)return;
  setBusy(true);setError("");setMessage("");let saved=0;
  try {
   for(const file of Array.from(files)) {
    if(file.size>5*1024*1024)throw Error(`${file.name}: файл больше 5 МБ.`);
    setMessage(`Загружаем ${saved+1} из ${files.length}: ${file.name}`);
    const form=new FormData();form.set("file",file);
    const response=await fetch(`/api/crm/clients/${encodeURIComponent(clientId)}/documents`,{method:"POST",body:form});
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(`${file.name}: ${body.error||"не удалось загрузить файл"}`);
    saved++;
   }
   setMessage(`Сохранено файлов: ${saved}.`);
  }catch(e){setError(e instanceof Error?e.message:"Не удалось загрузить файл.");setMessage(saved?`Сохранено файлов: ${saved}. Остальные не загружены.`:"");}
  finally{setBusy(false);if(input.current)input.current.value="";if(saved)router.refresh();}
 }
 return <section className="crm-client-files" aria-label="Документы клиента">
  <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-black">Документы клиента</h2><button type="button" className="avto-button rounded-xl px-4 py-3 font-bold disabled:opacity-60" disabled={busy||documents.length>=50} onClick={()=>input.current?.click()}>{busy?"Загружаем…":"Прикрепить файлы"}</button></div>
  <input ref={input} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xlsx" hidden onChange={event=>void upload(event.target.files)} />
  <p className="mt-2 text-sm text-[var(--ac-muted)]">Договоры, фотографии паспорта и другие документы. До 5 МБ на файл: JPG, PNG, WebP, PDF, DOC, DOCX, XLSX.</p>
  {opening&&<p role="status" className="mt-3 text-sm">Открываем документ…</p>}
  {message&&<p role="status" className="mt-3 text-sm">{message}</p>}{error&&<p role="alert" className="mt-3 text-sm text-red-500">{error}</p>}
  <div className="crm-client-files-grid">{documents.map(doc=><article key={doc.id} id={`document-${doc.id}`} className="crm-client-file">
   {doc.hasThumbnail||doc.mime==="application/pdf"?<button type="button" className="crm-client-file-preview" aria-label={`Просмотреть ${doc.name}`} disabled={opening} onClick={()=>void openDocument(doc)}>{doc.hasThumbnail?<img src={`${url(doc)}?preview=1`} alt="" loading="lazy" />:<span>PDF · Просмотр</span>}</button>:<a href={`${url(doc)}?download=1`} className="crm-client-file-preview" aria-label={`Скачать ${doc.name}`}>{doc.name.split(".").pop()?.toUpperCase()||"Файл"}</a>}
   <div className="crm-client-file-info"><strong>{doc.name}</strong><small>{Math.max(1,Math.round(doc.size/1024))} КБ</small><div className="crm-file-actions"><a href={`${url(doc)}?download=1`}>Скачать</a><button type="button" disabled={busy} onClick={()=>void trash(doc)} aria-label={`Удалить ${doc.name}`}>Удалить</button></div></div>
  </article>)}</div>
  {!documents.length&&<p className="mt-4 text-sm text-[var(--ac-muted)]">Документы пока не прикреплены.</p>}
  <a className="crm-trash-link" href="/crm/leads?view=archive#document-trash">Корзина документов →</a>
  <dialog ref={dialog} className="crm-file-dialog" onClose={()=>setPreview(null)} aria-label="Просмотр документа">
   {preview&&<><header><strong>{preview.name}</strong><button type="button" aria-label="Закрыть просмотр" onClick={()=>dialog.current?.close()}>Закрыть ×</button></header><img src={url(preview)} alt={preview.name} /><a href={`${url(preview)}?download=1`} className="text-sm underline">Скачать файл</a></>}
  </dialog>
  {pdf&&<Suspense fallback={<p role="status">Открываем PDF…</p>}><PdfPreview blob={pdf.blob} filename={pdf.name} onClose={()=>setPdf(null)} /></Suspense>}
 </section>;
}
