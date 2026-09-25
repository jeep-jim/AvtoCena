import {Check} from 'lucide-react';
import {ManualClientOrigin} from "@/components/crm/ManualClientOrigin";
import {crmDateTime,clientManagerId} from "@/lib/crm-time";
import {defaultManagerAvatar} from "@/lib/default-avatars";
import Link from "next/link";
import { redirect } from "next/navigation";
import { canSeeLead } from "@/lib/crm-visibility";
import { CrmShell } from "@/components/crm/CrmShell";
import { ClientCreatePanel } from "@/components/crm/ClientCreatePanel";
import { readChunkedDataJson } from "@/lib/data";
import { getCurrentUser, isCrmRole } from "@/lib/auth";
import { readCrmUsers } from "@/lib/crm-users";

export const dynamic = "force-dynamic";
export default async function CrmClientsPage({searchParams}: {searchParams?: Promise<Record<string,string|string[]|undefined>>}) {
  const user = await getCurrentUser();
  if (!user || !isCrmRole(user.role)) redirect("/login");
  const params = await searchParams || {};
  const q = String(Array.isArray(params.q) ? params.q[0] : params.q || "").trim();
  const managerId = String(Array.isArray(params.manager) ? params.manager[0] : params.manager || "");
  const query = q.toLocaleLowerCase("ru");
  const [stored, managers] = await Promise.all([readChunkedDataJson<any>("clients/clients.json", []), readCrmUsers()]);
  const clients = stored.filter(client => canSeeLead(user,client)).filter(client => !managerId || clientManagerId(client) === managerId).filter(client => {
    const text = [client.fio,client.phone,client.telegram,client.max,client.city,client.comment].filter(Boolean).join(" ").toLocaleLowerCase("ru");
    const phoneQuery = q.replace(/\D/g, "");
    return !query || text.includes(query) || (/^[+\d\s()-]+$/.test(q) && phoneQuery.length >= 3 && String(client.phone||"").replace(/\D/g, "").includes(phoneQuery));
  }).sort((a,b) => String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
  return <CrmShell activeHref="/crm/clients" title="Клиенты" subtitle="Клиентская база, контакты, документы и история обращений.">
    <div className="crm-clients-layout">
      <section className="min-w-0" aria-label="Клиентская база">
        <form className="crm-client-search" action="/crm/clients">
          <input name="q" defaultValue={q} aria-label="Поиск клиентов" placeholder="Имя, телефон, Telegram, город…" className="soft-input rounded-xl p-3" />
          <select name="manager" aria-label="Менеджер" defaultValue={managerId} className="soft-input rounded-xl p-3"><option value="">Все менеджеры</option>{managers.filter(m=>["owner","admin","manager"].includes(m.role)).map(m=><option key={m.id} value={m.id}>{m.displayName}</option>)}</select>
          <button className="avto-button rounded-xl px-4 font-bold">Найти</button>
        </form>
        <div className="mb-4 flex justify-between gap-3 text-sm text-[var(--ac-muted)]"><span>Найдено: {clients.length}</span>{(q || managerId) && <Link href="/crm/clients" className="underline">Сбросить поиск</Link>}</div>
        <div className="crm-clients-list">
          {clients.map(client => {const manager=managers.find(m=>m.id===clientManagerId(client));return <Link href={`/crm/clients/${encodeURIComponent(client.id)}`} key={client.id} className="crm-client-card">
            <div><h2>{client.fio || client.phone || client.telegram || "Клиент без имени"}</h2><p>{Array.from(new Set([client.phone,client.telegram,client.max,client.city].filter(Boolean))).join(" · ") || "Контакты не указаны"}</p>{client.comment && <p className="crm-client-comment line-clamp-2">{client.comment}</p>}{client.documents?.some((doc:any)=>!doc.deletedAt) && <div className="crm-client-file-strip">{client.documents.filter((doc:any)=>!doc.deletedAt).slice(0,3).map((doc:any) => <span key={doc.id} title={doc.name}>{doc.hasThumbnail ? <img src={`/api/crm/clients/${encodeURIComponent(client.id)}/documents/${doc.id}?preview=1`} alt="" loading="lazy" /> : <span aria-hidden="true">▤</span>}<small>{doc.name}</small></span>)}{client.documents.filter((doc:any)=>!doc.deletedAt).length > 3 && <small>+{client.documents.filter((doc:any)=>!doc.deletedAt).length-3}</small>}</div>}</div>
            <div className="crm-client-owner"><div className="crm-client-manager"><img src={manager?.avatarUrl||defaultManagerAvatar(clientManagerId(client))} alt="" width={36} height={36}/><span><strong>{manager?.displayName || "Не назначен"}</strong><time className="crm-client-date" dateTime={client.createdAt} title="Добавлен · Новокузнецк">{crmDateTime(client.createdAt)}</time></span></div><div className="crm-client-statuses"><ManualClientOrigin client={client} managers={managers} compact/>{client.assignedManagerId&&<span className="crm-client-assigned" title={`Назначен менеджер: ${manager?.displayName||'Неизвестен'}`}><Check size={14} aria-hidden="true"/>Назначен</span>}</div></div>
          </Link>;})}
          {!clients.length && <p className="rounded-2xl border border-[var(--ac-border)] p-6 text-[var(--ac-muted)]">{q ? "Клиенты не найдены. Попробуйте другое имя или телефон." : "Клиентов пока нет. Добавьте первого клиента через форму."}</p>}
        </div>
      </section>
      <aside className="crm-client-create" aria-label="Добавить клиента"><ClientCreatePanel /></aside>
    </div>
  </CrmShell>;
}
