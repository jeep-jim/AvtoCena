"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
import type {ClientDocument} from "@/lib/client-documents";
type Entry={clientId:string;clientName:string;document:ClientDocument};
export function DocumentTrash({entries}:{entries:Entry[]}) {
 const router=useRouter(),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 async function change(items:Entry[],action:"restore"|"purge") {
  if(action==="purge"&&!window.confirm(items.length===1?`Удалить «${items[0].document.name}» навсегда? Восстановить этот документ уже не получится.`:`Очистить корзину документов (${items.length})? Все показанные файлы будут удалены навсегда, восстановить их не получится.`))return;
  setBusy(true);setMessage("");let done=0;
  for(const entry of items){try{const response=await fetch(`/api/crm/clients/${encodeURIComponent(entry.clientId)}/documents/${entry.document.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,confirmed:action==="purge"})});if(response.ok)done++;}catch{/* Keep failed items available for retry. */}}
  setMessage(done===items.length?(action==="restore"?"Документ восстановлен.":`Удалено файлов: ${done}.`):`Обработано ${done} из ${items.length}. Остальные не изменены или ожидают завершения очистки. Обновите страницу и повторите попытку.`);setBusy(false);router.refresh();
 }
 return <section id="document-trash" className="crm-client-files" aria-label="Корзина документов">
  <header className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-black">Корзина документов</h2>{entries.length>0&&<button type="button" className="crm-trash-empty" disabled={busy} onClick={()=>void change(entries,"purge")}>Очистить корзину ({entries.length})</button>}</header>
  <p className="mt-2 text-sm text-[var(--ac-muted)]">Удалённые документы хранятся 30 дней. До окончания срока их можно восстановить. После 30 дней файлы автоматически очищаются.</p>
  {message&&<p role="status" className="mt-3 text-sm">{message}</p>}
  <div className="crm-client-files-grid">{entries.map(entry=>{const doc=entry.document,expires=Date.parse(doc.deletedAt!)+30*86400000,expired=expires<=Date.now(),locked=expired||!!doc.purgeToken;return <article className="crm-client-file" key={`${entry.clientId}/${doc.id}`}>
   {!locked?<a className="crm-client-file-preview" href={`/api/crm/clients/${encodeURIComponent(entry.clientId)}/documents/${doc.id}`} target="_blank" rel="noreferrer" aria-label={`Открыть ${doc.name}`}>{doc.hasThumbnail?<img src={`/api/crm/clients/${encodeURIComponent(entry.clientId)}/documents/${doc.id}?preview=1`} alt="" loading="lazy"/>:<span>{doc.name.split(".").pop()?.toUpperCase()||"Файл"}</span>}</a>:<div className="crm-client-file-preview">Очистка…</div>}
   <div className="crm-client-file-info"><strong>{doc.name}</strong><a href={`/crm/clients/${encodeURIComponent(entry.clientId)}`}>{entry.clientName}</a><p className="mt-2 text-[var(--ac-muted)]">{locked?"Ожидает удаления":`Хранится до ${new Date(expires).toLocaleDateString("ru-RU",{timeZone:"Asia/Novokuznetsk"})}`}</p><div className="crm-file-actions"><button type="button" disabled={busy||locked} onClick={()=>void change([entry],"restore")}>Восстановить</button><button type="button" disabled={busy} onClick={()=>void change([entry],"purge")}>Удалить навсегда</button></div></div>
  </article>})}</div>
  {!entries.length&&<p className="mt-3 text-sm text-[var(--ac-muted)]">Корзина пуста.</p>}
 </section>;
}
