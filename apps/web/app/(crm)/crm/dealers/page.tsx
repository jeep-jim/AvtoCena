import Link from "next/link";
import { CrmShell } from "@/components/crm/CrmShell";
import { readChunkedDataJson, readDataJson } from "@/lib/data";

export const dynamic = "force-dynamic";

const pilotDealer = {
  id: "dealer_topavto",
  name: "TopAvto",
  city: "Новокузнецк",
  status: "verified",
  pilot: true,
  markets: ["Япония", "Китай", "Корея", "ОАЭ", "Европа", "Грузия"],
  telegramChannel: "",
  telegramConnected: false,
  logoUrl: "",
  headerImageUrl: "",
  reviewsEnabled: true,
  photoFeedEnabled: true,
};

function statusLabel(value: string) {
  if (value === "verified") return "Проверен";
  if (value === "active") return "Подключён";
  if (value === "paused") return "Приостановлен";
  return "Новая заявка";
}

export default async function CrmDealersPage() {
  const [storedDealers, applications] = await Promise.all([
    readDataJson<any[]>("dealers/dealers.json", []),
    readChunkedDataJson<any>("dealers/applications.json", []),
  ]);
  const dealers = storedDealers.length ? storedDealers : [pilotDealer];
  const sortedApplications = [...applications].sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""));

  return (
    <CrmShell activeHref="/crm/dealers" title="Дилеры" subtitle="Компании платформы, их города, рынки, Telegram-профили и заявки на подключение.">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {dealers.map((dealer) => (
          <Link key={dealer.id} href={`/crm/dealers/${encodeURIComponent(dealer.id)}`} className="glass rounded-[1.6rem] p-5 transition hover:-translate-y-0.5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                {dealer.logoUrl ? <img src={dealer.logoUrl} alt="" className="h-14 w-14 rounded-2xl object-cover" referrerPolicy="no-referrer" /> : <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white text-sm font-black text-black">{String(dealer.name || "Д").slice(0, 2).toUpperCase()}</div>}
                <div className="min-w-0">
                  <div className="text-xs font-black uppercase tracking-[.12em] text-red-400">{dealer.pilot ? "Пилот" : "Дилер"}</div>
                  <h2 className="mt-1 truncate text-2xl font-black">{dealer.name}</h2>
                  <div className="mt-1 text-sm font-bold text-white/48">{dealer.city || "Город не указан"}</div>
                </div>
              </div>
              <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-black text-emerald-300">{statusLabel(dealer.status)}</span>
            </div>
            <div className="mt-5 rounded-2xl bg-white/[.045] p-4"><div className="text-xs font-bold text-white/38">Рынки</div><div className="mt-2 text-sm font-black leading-6 text-white/80">{Array.isArray(dealer.markets) ? dealer.markets.join(" · ") : "—"}</div></div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm font-bold">
              <div className="rounded-2xl bg-white/[.045] p-3"><div className="text-xs text-white/38">Сотрудники</div><div className="mt-1 text-2xl font-black">{dealer.teamSize || 0}</div></div>
              <div className="rounded-2xl bg-white/[.045] p-3"><div className="text-xs text-white/38">Telegram</div><div className="mt-1 text-sm font-black">{dealer.telegramConnected ? "подключён" : "не подключён"}</div></div>
            </div>
            <div className="mt-4 text-sm font-black text-red-300">Открыть карточку компании →</div>
          </Link>
        ))}
      </section>

      <section className="glass mt-6 rounded-[1.8rem] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-black">Заявки на подключение</h2><p className="mt-1 text-sm font-bold text-white/48">Новые компании с публичного лендинга для дилеров.</p></div><span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black text-white/60">{sortedApplications.length}</span></div>
        <div className="mt-5 grid gap-3">
          {sortedApplications.length ? sortedApplications.map((item) => (
            <article key={item.id} className="grid gap-3 rounded-2xl bg-white/[.045] p-4 md:grid-cols-[1.1fr_.8fr_.8fr_auto] md:items-center">
              <div><div className="font-black text-white">{item.companyName}</div><div className="mt-1 text-sm font-bold text-white/45">{item.contactName} · {item.city}</div></div>
              <div className="text-sm font-bold text-white/65"><div>{item.phone}</div><div className="mt-1 text-white/40">{item.telegram || "Telegram не указан"}</div></div>
              <div className="text-sm font-bold text-white/55"><div>{item.teamSize ? `${item.teamSize} сотрудников` : "Размер команды не указан"}</div><div className="mt-1 line-clamp-2">{item.markets || "Рынки не указаны"}</div></div>
              <span className="w-fit rounded-full bg-red-500/15 px-3 py-1 text-xs font-black text-red-300">{statusLabel(item.status)}</span>
            </article>
          )) : <div className="rounded-2xl bg-white/[.04] px-5 py-7 text-sm font-bold text-white/45">Заявок на подключение пока нет.</div>}
        </div>
      </section>
    </CrmShell>
  );
}
