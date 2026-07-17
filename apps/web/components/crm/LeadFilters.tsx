"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { DarkSelect } from "./DarkSelect";
import { LEAD_STATUSES, LEAD_STATUS_LABELS } from "@/lib/crm";
export function LeadFilters({ managers, sources }: { managers: {id:string;displayName:string}[]; sources: string[] }) {
  const router = useRouter(); const sp = useSearchParams();
  const value = (key:string)=>sp.get(key)||"";
  const set = (key:string, next:string)=>{const p=new URLSearchParams(sp.toString()); if(next)p.set(key,next); else p.delete(key); router.push(`/crm/leads?${p.toString()}`)};
  return <div className="glass mb-5 grid gap-3 rounded-[2rem] p-5 md:grid-cols-5"><input placeholder="ФИО, телефон, автомобиль" defaultValue={value("q")} onBlur={(e)=>set("q",e.target.value)} className="soft-input rounded-2xl px-4 py-3 text-sm font-bold"/><DarkSelect label="Менеджер" name="managerId" value={value("managerId")} onChange={(v)=>set("managerId",v)} options={[{value:"",label:"Все менеджеры"},...managers.map((m)=>({value:m.id,label:m.displayName}))]}/><DarkSelect label="Источник" name="source" value={value("source")} onChange={(v)=>set("source",v)} options={[{value:"",label:"Все источники"},...sources.map((source)=>({value:source,label:source==="manual"?"Ручное добавление":source==="site"?"Сайт":source||"—"}))]}/><DarkSelect label="Статус" name="status" value={value("status")} onChange={(v)=>set("status",v)} options={[{value:"",label:"Все статусы"},...LEAD_STATUSES.map((status)=>({value:status,label:LEAD_STATUS_LABELS[status]}))]}/><input name="date" type="date" defaultValue={value("date")} onBlur={(e)=>set("date",e.target.value)} className="soft-input rounded-2xl px-4 py-3 text-sm font-bold [color-scheme:dark]"/></div>
}
