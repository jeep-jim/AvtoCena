"use client";
import {CLIENT_STATUSES} from "../../lib/crm-client-status";
import { useState } from "react";
import { useRouter } from "next/navigation";
type Client = {id:string; fio:string; phone:string; telegram:string; max?:string; city:string; comment:string; updatedAt:string;status?:string;assignedManagerId?:string};
export function ClientEditForm({client,managers=[],canAssign=false,canEdit=true}: {client:Client;managers?:{id:string;displayName:string}[];canAssign?:boolean;canEdit?:boolean}) {
 const router = useRouter();
 const [form,setForm] = useState(client), [busy,setBusy] = useState(false), [message,setMessage] = useState("");
 async function submit(event: React.FormEvent) {
  event.preventDefault();setBusy(true);setMessage("");
  try {
   const response = await fetch(`/api/crm/clients/${encodeURIComponent(client.id)}`, {method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)});
   const result = await response.json();
   if (!response.ok) throw Error(result.error === "client_conflict" ? "Клиент изменён другим сотрудником. Обновите страницу перед сохранением." : result.error === "client_contact_required" ? "Укажите имя, телефон или Telegram." : "Не удалось сохранить клиента. Проверьте доступ и повторите попытку.");
   setForm(result.client);setMessage("Изменения сохранены.");router.refresh();
  } catch(error) {setMessage(error instanceof Error ? error.message : "Не удалось сохранить клиента.");}
  finally {setBusy(false);}
 }
 return <form onSubmit={submit} className="glass grid max-w-3xl gap-4 rounded-3xl p-5">
  <fieldset disabled={!canEdit} className="contents"><label className="grid gap-2 text-sm font-bold">ФИО<input value={form.fio} onChange={e=>setForm({...form,fio:e.target.value})} className="soft-input rounded-xl px-4 py-3"/></label>
  <div className="crm-contact-row">{([["phone","Телефон"],["telegram","Telegram"],["max","MAX"]] as const).map(([key,label])=><label key={key} className="grid gap-2 text-sm font-bold">{label}<input type={key==='phone'?'tel':'text'} maxLength={500} value={form[key]||''} onChange={e=>setForm({...form,[key]:e.target.value})} className="soft-input rounded-xl px-4 py-3"/></label>)}</div>
  <label className="grid gap-2 text-sm font-bold">Город<input value={form.city} onChange={e=>setForm({...form,city:e.target.value})} className="soft-input rounded-xl px-4 py-3"/></label>
  <label className="grid gap-2 text-sm font-bold">Комментарий<textarea maxLength={4000} rows={4} value={form.comment} onChange={event=>setForm({...form,comment:event.target.value})} className="soft-input rounded-xl px-4 py-3"/></label>
  <label className="grid gap-2 text-sm font-bold">Статус клиента<select value={form.status||'new'} onChange={e=>setForm({...form,status:e.target.value})} className="soft-input rounded-xl px-4 py-3">{Object.entries(CLIENT_STATUSES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
  {canAssign?<label className="grid gap-2 text-sm font-bold">Ответственный менеджер<select value={form.assignedManagerId||''} onChange={e=>setForm({...form,assignedManagerId:e.target.value})} className="soft-input rounded-xl px-4 py-3"><option value="">Не назначен</option>{managers.map(m=><option key={m.id} value={m.id}>{m.displayName}</option>)}</select></label>:null}
  </fieldset>
  {message?<p role="status">{message}</p>:null}
  {canEdit?<button disabled={busy} className="avto-button min-h-12 rounded-xl px-4 font-black disabled:opacity-50">{busy?"Сохраняем…":"Сохранить изменения"}</button>:null}
 </form>;
}
