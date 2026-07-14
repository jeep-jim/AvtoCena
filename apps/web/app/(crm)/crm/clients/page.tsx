import Link from "next/link";
import { CrmShell } from "@/components/crm/CrmShell";
import { ClientCreateForm } from "@/components/crm/ClientCreateForm";
import { readChunkedDataJson } from "@/lib/data";
import { getAuthUsers } from "@/lib/auth";
import { money } from "@/lib/avtocena";
import { searchClients } from "@/lib/crm";

export const dynamic = "force-dynamic";
function managerName(managers: any[], id?: string) { return managers.find((m) => m.id === id)?.displayName || "Не назначен"; }
function dateTime(value?: string) { return value ? new Date(value).toLocaleString("ru-RU") : "—"; }

export default async function CrmClientsPage({ searchParams }: { searchParams?: Record<string,string> }) {
  const allClients = await readChunkedDataJson<any>("clients/clients.json", []);
  const leads = await readChunkedDataJson<any>("leads/leads.json", []);
  const deals = await readChunkedDataJson<any>("deals/deals.json", []);
  const managers = (await getAuthUsers());
  const clients = searchClients(allClients, { name: searchParams?.name, phone: searchParams?.phone, telegram: searchParams?.telegram, car: searchParams?.car, managerId: searchParams?.managerId, date: searchParams?.date });
  return <CrmShell activeHref="/crm/clients" title="Клиенты" subtitle="Поиск, редактирование, архив и полноценные карточки клиентов.">
    <div className="grid gap-5 lg:grid-cols-[420px_1fr]"><ClientCreateForm />
      <div className="glass overflow-hidden rounded-[2rem] p-5">
        <form className="grid gap-3 md:grid-cols-3">
          <input name="name" placeholder="Поиск по ФИО" defaultValue={searchParams?.name} className="soft-input rounded-2xl px-4 py-3 text-sm font-bold" />
          <input name="phone" placeholder="Телефон" defaultValue={searchParams?.phone} className="soft-input rounded-2xl px-4 py-3 text-sm font-bold" />
          <input name="telegram" placeholder="Telegram" defaultValue={searchParams?.telegram} className="soft-input rounded-2xl px-4 py-3 text-sm font-bold" />
          <input name="car" placeholder="Автомобиль" defaultValue={searchParams?.car} className="soft-input rounded-2xl px-4 py-3 text-sm font-bold" />
          <select name="managerId" defaultValue={searchParams?.managerId || ""} className="soft-input rounded-2xl bg-zinc-950 px-4 py-3 text-sm font-bold text-white"><option value="">Все менеджеры</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}</select>
          <input name="date" type="date" defaultValue={searchParams?.date} className="soft-input rounded-2xl px-4 py-3 text-sm font-bold [color-scheme:dark]" />
          <button className="avto-button rounded-2xl px-5 py-3 font-black md:col-span-3">Найти клиента</button>
        </form>
        <div className="mx-3 my-5 border-t border-white/10" />
        <div className="space-y-3">{clients.map((client) => { const clientLeads = leads.filter((l) => l.clientId === client.id); const clientDeals = deals.filter((d) => d.clientId === client.id); return <Link href={`/crm/clients/${client.id}`} key={client.id} className="block rounded-3xl bg-white/7 p-5 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-red-300/60">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-lg font-black">{client.fio || client.phone || client.telegram || "Клиент без имени"}</div><div className="mt-1 text-sm font-bold text-white/50">Добавлен: {dateTime(client.createdAt)} · Изменён: {dateTime(client.updatedAt)}</div></div><span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-black text-emerald-100">{client.status === "archived" ? "В архиве" : "Активен"}</span></div>
          <div className="mt-4 grid gap-3 text-sm font-bold text-white/62 md:grid-cols-4"><div>Контакты: {client.phone || "—"} {client.telegram || ""}</div><div>Авто: {client.interestedCar || client.car || "—"}</div><div>Бюджет: {client.budgetRub ? `${money(client.budgetRub)} ₽` : "—"}</div><div>Менеджер: {managerName(managers, client.assignedManagerId)}</div></div>
          <div className="mt-3 text-xs font-black uppercase tracking-[0.14em] text-white/35">Лиды: {clientLeads.length} · Сделки: {clientDeals.length} · Документы: {(client.documents || []).length}</div>
        </Link>; })}</div>
        {!clients.length && <div className="p-8 text-center text-sm font-bold text-white/50">Клиенты не найдены.</div>}
      </div></div></CrmShell>;
}
