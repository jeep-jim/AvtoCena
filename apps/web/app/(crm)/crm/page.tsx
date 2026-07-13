import Link from "next/link";
import { CrmShell } from "@/components/crm/CrmShell";
import { readChunkedDataJson, readDataJson } from "@/lib/data";
import { getAuthUsers, getCurrentUser, isCrmRole } from "@/lib/auth";
import { money } from "@/lib/avtocena";
import { getActiveDirectPartnerPayout } from "@/lib/business-settings";

export const dynamic = "force-dynamic";

export default async function CrmPage() {
  const user = getCurrentUser();
  const leads = await readChunkedDataJson<any>("leads/leads.json", []);
  const clients = await readChunkedDataJson<any>("clients/clients.json", []);
  const partners = await readDataJson<any[]>("partners/partners.json", []);
  const deals = await readDataJson<any[]>("deals/deals.json", []);
  const managers = getAuthUsers().filter((item) => isCrmRole(item.role));
  const myLeads = leads.filter((lead) => lead.assignedManagerId === user?.id || lead.createdByManagerId === user?.id);
  const newLeads = leads.filter((lead) => (lead.status || "new") === "new");
  const directPayout = await getActiveDirectPartnerPayout();

  return (
    <CrmShell activeHref="/crm" title="Панель управления" subtitle="Общая CRM TopAvto: заявки, менеджеры, клиенты, партнёры и сделки.">
      <div className="grid gap-4 md:grid-cols-4">
        <div className="glass rounded-3xl p-5"><div className="text-sm font-bold text-white/45">Все лиды</div><div className="mt-2 text-4xl font-black">{leads.length}</div></div>
        <div className="glass rounded-3xl p-5"><div className="text-sm font-bold text-white/45">Мои заявки</div><div className="mt-2 text-4xl font-black">{myLeads.length}</div></div>
        <div className="glass rounded-3xl p-5"><div className="text-sm font-bold text-white/45">Клиенты</div><div className="mt-2 text-4xl font-black">{clients.length}</div></div>
        <div className="glass rounded-3xl p-5"><div className="text-sm font-bold text-white/45">Менеджеры</div><div className="mt-2 text-4xl font-black">{managers.length}</div></div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="glass rounded-[2rem] p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-black">Общая лента</h2>
            <Link href="/crm/feed" className="rounded-full bg-white/10 px-4 py-2 text-sm font-black text-white/70">Открыть ленту</Link>
          </div>

          <div className="mt-5 space-y-3">
            {(leads.length ? leads.slice(0, 6) : []).map((lead) => (
              <div key={lead.id} className="rounded-2xl bg-white/7 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="font-black">{lead.name || lead.phone || lead.telegram || "Новый лид"}</div>
                  <span className="rounded-full bg-red-500/20 px-3 py-1 text-xs font-black text-red-100">{lead.status || "new"}</span>
                </div>
                <div className="mt-1 text-sm font-bold text-white/48">{lead.car || "Авто не выбрано"} · {lead.source || "site"}</div>
              </div>
            ))}

            {!leads.length && <div className="rounded-2xl bg-white/7 px-4 py-5 text-sm font-bold text-white/50">Пока нет заявок. Они появятся после формы на сайте или ручного добавления клиента.</div>}
          </div>
        </div>

        <div className="grid gap-5">
          <div className="glass rounded-[2rem] p-6">
            <h2 className="text-2xl font-black">Быстрые действия</h2>
            <div className="mt-5 grid gap-3">
              <Link href="/crm/clients" className="avto-button rounded-2xl px-5 py-4 text-center font-black">Добавить клиента</Link>
              <Link href="/crm/leads?view=my" className="rounded-2xl bg-white/10 px-5 py-4 text-center font-black text-white/70">Мои заявки</Link>
              <Link href="/crm/managers" className="rounded-2xl bg-white/10 px-5 py-4 text-center font-black text-white/70">Менеджеры</Link>
            </div>
          </div>

          <div className="glass rounded-[2rem] p-6">
            <h2 className="text-2xl font-black">Сводка</h2>
            <div className="mt-4 space-y-3 text-sm font-bold text-white/62">
              <p>Новые заявки: {newLeads.length}</p>
              <p>Сделки: {deals.length}</p>
              <p>Партнёры: {partners.length}</p>
              <p>Выплата за договор: {money(Number(directPayout?.defaultSignedContractPayoutRub || 0))} ₽</p>
            </div>
          </div>
        </div>
      </div>
    </CrmShell>
  );
}
