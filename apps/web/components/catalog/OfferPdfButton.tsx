"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileDown, X, Eye, Download } from "lucide-react";

export function OfferPdfButton({offerId,draft}:{offerId:string;draft:Record<string,string>}) {
 const [hosts,setHosts]=useState<HTMLElement[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const dialog=useRef<HTMLDialogElement>(null);
 const urls=useRef<string[]>([]);
 useEffect(()=>{
  const targets=Array.from(document.querySelectorAll<HTMLElement>("[data-offer-pdf-slot]"));setHosts(targets);
  targets.forEach(t=>t.parentElement?.setAttribute("data-has-pdf","true"));
  return ()=>{targets.forEach(t=>t.parentElement?.removeAttribute("data-has-pdf"));urls.current.forEach(url=>URL.revokeObjectURL(url));};
 },[]);
 async function generate(mode:"view"|"download") {
  if(busy)return;setBusy(true);setError("");
  // Open synchronously in the click handler so mobile browsers do not block the viewer.
  const viewer=mode==="view"?window.open("about:blank","_blank"):null;
  if(mode==="view" && !viewer){setError("Разрешите открытие новой вкладки или выберите «Скачать».");setBusy(false);return;}
  if(viewer){viewer.opener=null;viewer.document.title="Подготовка PDF";viewer.document.body.textContent="Подготавливаем PDF…";}
  try{
   const response=await fetch(`/api/catalog/offer/${encodeURIComponent(offerId)}/pdf`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({draft})});
   if(!response.ok){const data=await response.json();throw Error(data.error || "Не удалось подготовить PDF");}
   const blob=await response.blob();if(!blob.type.includes("application/pdf"))throw Error("Сервер не вернул PDF. Попробуйте ещё раз.");
   const url=URL.createObjectURL(blob);urls.current.push(url);
   if(viewer)viewer.location.replace(url);
   else {const link=document.createElement("a");link.href=url;link.download=`АвтоЦена-${offerId.replace(/[^a-zA-Z0-9_-]/g,"_")}.pdf`;document.body.appendChild(link);link.click();link.remove();}
   dialog.current?.close();
  }catch(e){viewer?.close();setError(e instanceof Error?e.message:"Не удалось подготовить PDF");}
  finally{setBusy(false);}
 }
 const button=(mobile=false)=><button type="button" aria-label="PDF текущей карточки" onClick={()=>{setError("");dialog.current?.showModal();}} className={`inline-flex h-14 items-center justify-center gap-2 rounded-[1.05rem] bg-[#F59E0B] px-5 text-sm font-black !text-[#171C24] transition-[filter,transform] hover:brightness-95 active:scale-[.99] ${mobile?"mt-3 w-full xl:hidden":"w-full"}`}><FileDown size={21} aria-hidden/><span>PDF</span></button>;
 return <>
  {button(true)}
  {hosts.map((host,i)=>createPortal(button(),host,String(i)))}
  <dialog ref={dialog} aria-labelledby={`pdf-title-${offerId}`} onCancel={e=>{if(busy)e.preventDefault();}} className="m-auto w-[min(420px,calc(100vw-32px))] rounded-3xl border border-[var(--ac-border)] bg-[var(--ac-surface)] p-6 text-[var(--ac-text)] shadow-2xl backdrop:bg-black/65">
   <div className="flex items-center justify-between gap-3"><h2 id={`pdf-title-${offerId}`} className="text-xl font-black">Карточка в PDF</h2><button type="button" aria-label="Закрыть" disabled={busy} onClick={()=>dialog.current?.close()} className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--ac-surface-2)]"><X size={20}/></button></div>
   <p className="mt-2 text-sm text-[var(--ac-muted)]">Текущие характеристики и расчёт автомобиля.</p>
   <div className="mt-5 grid gap-3"><button type="button" disabled={busy} onClick={()=>void generate("view")} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#F59E0B] px-4 font-bold text-[#171C24] disabled:opacity-60"><Eye size={20}/>{busy?"Подготавливаем…":"Просмотреть"}</button><button type="button" disabled={busy} onClick={()=>void generate("download")} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--ac-surface-2)] px-4 font-bold disabled:opacity-60"><Download size={20}/>Скачать PDF</button></div>
   {error?<p role="alert" className="mt-3 text-sm text-red-400">{error}</p>:null}
  </dialog>
 </>;
}
