import Link from "next/link";
import { redirect } from "next/navigation";
import { canSeeLead } from "@/lib/crm-visibility";
import { CrmShell } from "@/components/crm/CrmShell";
import { ClientCreateForm } from "@/components/crm/ClientCreateForm";
import { readChunkedDataJson } from "@/lib/data";
import { getCurrentUser, isCrmRole } from "@/lib/auth";
import { readCrmUsers } from "@/lib/crm-users";

export const dynamic = "force-dynamic";
export default async function CrmClientsPage({searchParams}: {searchParams?: Promise<Record<string,string|string[]|undefined>>}) {
  const user = await getCurrentUser();
  if (!user || !isCrmRole(user.role)) redirect("/login");
  const params = await searchParams || {};
  const q = String(Array.isArray(params.q) ? params.q[0] : params.q || "").trim();
  const query = q.toLocaleLowerCase("ru");
  const [stored, managers] = await Promise.all([readChunkedDataJson<any>("clients/clients.json", []), readCrmUsers()]);
  const clients = stored.filter(client => canSeeLead(user,client)).filter(client => {
    const text = [client.fio,client.phone,client.telegram,client.city,client.comment].filter(Boolean).join(" ").toLocaleLowerCase("ru");
    const phoneQuery = q.replace(/\D/g, "");
    return !query || text.includes(query) || (/^[+\d\s()-]+$/.test(q) && phoneQuery.length >= 3 && String(client.phone||"").replace(/\D/g, "").includes(phoneQuery));
  }).sort((a,b) => String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
  return <CrmShell activeHref="/crm/clients" title="Клиенты" subtitle="Клиентская база, контакты, документы и история обращений.">
    <div className="crm-clients-layout">
      <section className="min-w-0" aria-label="Клиентская база">
        <form className="crm-client-search" action="/crm/clients">
          <input name="q" defaultValue={q} aria-label="Поиск клиентов" placeholder="Имя, телефон, Telegram, город…" className="soft-input rounded-xl p-3" />
          <button className="avto-button rounded-xl px-4 font-bold">Найти</button>
        </form>
        <div className="mb-4 flex justify-between gap-3 text-sm text-[var(--ac-muted)]"><span>Найдено: {clients.length}</span>{q && <Link href="/crm/clients" className="underline">Сбросить поиск</Link>}</div>
        <div className="crm-clients-list">
          {clients.map(client => <Link href={`/crm/clients/${encodeURIComponent(client.id)}`} key={client.id} className="crm-client-card">
            <span className="crm-client-avatar" aria-hidden="true">{String(client.fio || "К").slice(0,1).toUpperCase()}</span>
            <div><h2>{client.fio || client.phone || client.telegram || "Клиент без имени"}</h2><p>{[client.phone,client.telegram,client.city].filter(Boolean).join(" · ") || "Контакты не указаны"}</p>{client.comment && <p className="line-clamp-2">{client.comment}</p>}{client.documents?.length > 0 && <div className="crm-client-file-strip">{client.documents.slice(0,3).map((doc:any) => <span key={doc.id} title={doc.name}>{doc.hasThumbnail ? <img src={`/api/crm/clients/${encodeURIComponent(client.id)}/documents/${doc.id}?preview=1`} alt="" loading="lazy" /> : <span aria-hidden="true">▤</span>}<small>{doc.name}</small></span>)}{client.documents.length > 3 && <small>+{client.documents.length-3}</small>}</div>}</div>
            <div className="crm-client-manager">Менеджер<strong>{managers.find(manager => manager.id===client.assignedManagerId)?.displayName || "Не назначен"}</strong><p>Открыть →</p></div>
          </Link>)}
          {!clients.length && <p className="rounded-2xl border border-[var(--ac-border)] p-6 text-[var(--ac-muted)]">{q ? "Клиенты не найдены. Попробуйте другое имя или телефон." : "Клиентов пока нет. Добавьте первого клиента через форму."}</p>}
        </div>
      </section>
      <aside className="crm-client-create" aria-label="Добавить клиента"><ClientCreateForm /></aside>
    </div>
  </CrmShell>;
}
