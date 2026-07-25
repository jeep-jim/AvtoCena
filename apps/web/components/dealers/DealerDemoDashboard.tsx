"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const navItems = ["Обзор", "Заявки", "Клиенты", "Команда", "Рынки", "Компания"] as const;

const leadPool = [
  { id: 1, city: "Новокузнецк", client: "Алексей", car: "Кроссовер до 2 млн ₽", source: "Сайт", status: "Новая", tone: "new", time: "1 мин" },
  { id: 2, city: "Кемерово", client: "Марина", car: "Honda Fit из Японии", source: "Telegram", status: "В работе", tone: "work", time: "6 мин" },
  { id: 3, city: "Барнаул", client: "Олег", car: "Новый Geely до 3 млн ₽", source: "Сайт", status: "Расчёт", tone: "ready", time: "18 мин" },
  { id: 4, city: "Томск", client: "Ирина", car: "Kia Sorento из Кореи", source: "Рекомендация", status: "Сделка", tone: "deal", time: "сегодня" },
  { id: 5, city: "Новосибирск", client: "Денис", car: "BMW 3 из Китая", source: "Telegram", status: "Без ответа", tone: "late", time: "24 мин" },
] as const;

const tones: Record<string, string> = {
  new: "bg-emerald-400/15 text-emerald-300",
  work: "bg-amber-400/15 text-amber-200",
  ready: "bg-sky-400/15 text-sky-300",
  deal: "bg-red-500/15 text-red-300",
  late: "bg-orange-400/15 text-orange-200",
};

const activity = [
  "Иван принял заявку из Кемерово",
  "Расчёт Toyota Corolla отправлен клиенту",
  "TopAvto получил новый отзыв 5★",
  "Автомобиль клиента прибыл во Владивосток",
] as const;

export function DealerDemoDashboard() {
  const [activeNav, setActiveNav] = useState<(typeof navItems)[number]>("Обзор");
  const [leadOffset, setLeadOffset] = useState(0);
  const [activityIndex, setActivityIndex] = useState(0);
  const [toastVisible, setToastVisible] = useState(true);

  const visibleLeads = useMemo(() => leadPool.map((_, index) => leadPool[(index + leadOffset) % leadPool.length]).slice(0, 4), [leadOffset]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setLeadOffset((value) => (value + 1) % leadPool.length);
      setActivityIndex((value) => (value + 1) % activity.length);
      setToastVisible(true);
      window.setTimeout(() => setToastVisible(false), 3600);
    }, 8400);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="dealer-demo-shell mx-auto w-full max-w-[1500px] px-4 pb-14 pt-7 md:px-8 md:pb-20 md:pt-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-sm font-black uppercase tracking-[.18em] text-red-400">Демо без регистрации</div>
          <h1 className="mt-2 text-4xl font-black tracking-[-.05em] md:text-6xl">Посмотрите CRM изнутри</h1>
          <p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-[var(--demo-muted)] md:text-base">Все данные демонстрационные. Нажимайте разделы, смотрите заявки и оцените, как будет выглядеть рабочий кабинет вашей компании.</p>
        </div>
        <Link href="/dealers#connect" className="rounded-2xl bg-red-500 px-6 py-4 text-sm font-black text-white">Подключить компанию</Link>
      </div>

      <section className="dealer-demo-window overflow-hidden rounded-[2rem] bg-[var(--demo-panel)]">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/7 px-4 py-4 md:px-6">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white text-sm font-black text-black">TA</div>
            <div><div className="font-black">TopAvto · демо</div><div className="text-xs font-bold text-[var(--demo-muted)]">Новокузнецк · 7 рынков</div></div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden rounded-full bg-emerald-400/12 px-3 py-2 text-xs font-black text-emerald-300 sm:inline-flex">● Система работает</span>
            <span className="grid h-10 w-10 place-items-center rounded-full bg-[var(--demo-soft)] text-sm font-black">АН</span>
          </div>
        </header>

        <nav className="flex gap-2 overflow-x-auto border-b border-white/7 px-4 py-3 [scrollbar-width:none] md:px-6" aria-label="Демо-разделы">
          {navItems.map((item) => <button key={item} type="button" onClick={() => setActiveNav(item)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-black transition ${activeNav === item ? "bg-red-500 text-white" : "bg-[var(--demo-soft)] text-[var(--demo-muted)] hover:text-[var(--demo-text)]"}`}>{item}</button>)}
        </nav>

        <div className="grid gap-4 p-4 md:p-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[["Новые заявки", "18", "+4 сегодня"], ["Без ответа", "3", "нужен ответ"], ["В работе", "47", "6 менеджеров"], ["В пути", "12", "2 скоро выдача"]].map(([label, value, note]) => (
                <article key={label} className="rounded-[1.5rem] bg-[var(--demo-card)] p-4 md:p-5">
                  <div className="text-xs font-bold text-[var(--demo-muted)]">{label}</div>
                  <div className="mt-2 text-3xl font-black md:text-4xl">{value}</div>
                  <div className="mt-2 text-[11px] font-black text-red-400">{note}</div>
                </article>
              ))}
            </div>

            <section className="rounded-[1.6rem] bg-[var(--demo-card)] p-4 md:p-5">
              <div className="flex items-center justify-between gap-3"><div><h2 className="text-2xl font-black">{activeNav === "Обзор" ? "Последние заявки" : activeNav}</h2><p className="mt-1 text-xs font-bold text-[var(--demo-muted)]">Живая очередь компании</p></div><button type="button" onClick={() => setLeadOffset((value) => (value + 1) % leadPool.length)} className="rounded-xl bg-[var(--demo-soft)] px-3 py-2 text-xs font-black">Обновить</button></div>
              <div key={leadOffset} className="mt-4 grid gap-2 dealer-demo-fade">
                {visibleLeads.map((lead) => (
                  <article key={`${lead.id}-${leadOffset}`} className="grid gap-3 rounded-2xl bg-[var(--demo-soft)] p-3.5 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--demo-avatar)] text-sm font-black">{lead.client.slice(0, 1)}</div>
                      <div className="min-w-0"><div className="truncate text-sm font-black">{lead.client} · {lead.city}</div><div className="mt-1 truncate text-xs font-bold text-[var(--demo-muted)]">{lead.car} · {lead.source} · {lead.time}</div></div>
                    </div>
                    <span className={`w-fit rounded-full px-3 py-1.5 text-[11px] font-black ${tones[lead.tone]}`}>{lead.status}</span>
                  </article>
                ))}
              </div>
            </section>
          </div>

          <aside className="space-y-4">
            <section className="rounded-[1.6rem] bg-[var(--demo-card)] p-5">
              <div className="flex items-center justify-between"><h2 className="text-xl font-black">Команда</h2><span className="text-xs font-black text-emerald-300">6 онлайн</span></div>
              <div className="mt-4 grid gap-3">
                {[["Иван Чумаков", "8 заявок", "И"], ["Антон Молодых", "5 заявок", "А"], ["Мария Орлова", "4 заявки", "М"]].map(([name, count, initial]) => (
                  <div key={name} className="flex items-center justify-between rounded-2xl bg-[var(--demo-soft)] p-3"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-full bg-[var(--demo-avatar)] text-xs font-black">{initial}</span><div><div className="text-sm font-black">{name}</div><div className="text-xs font-bold text-[var(--demo-muted)]">онлайн</div></div></div><span className="text-xs font-black text-[var(--demo-muted)]">{count}</span></div>
                ))}
              </div>
            </section>

            <section className="rounded-[1.6rem] bg-[var(--demo-card)] p-5">
              <div className="flex items-center justify-between"><h2 className="text-xl font-black">Сегодня</h2><span className="text-xs font-black text-red-400">+12%</span></div>
              <div className="mt-4 flex h-28 items-end gap-2" aria-label="График заявок">
                {[32, 47, 38, 68, 54, 88, 72, 96, 78, 110, 92, 122].map((height, index) => <span key={index} className="flex-1 rounded-t-md bg-red-500/75 transition-all" style={{ height }} />)}
              </div>
              <div className="mt-3 flex justify-between text-[10px] font-bold text-[var(--demo-muted)]"><span>09:00</span><span>Сейчас</span></div>
            </section>
          </aside>
        </div>
      </section>

      <div className={`pointer-events-none fixed bottom-5 right-5 z-[6000] max-w-[330px] rounded-2xl bg-[#12151d] px-4 py-3 text-sm font-black text-white transition duration-500 ${toastVisible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"}`}>
        <div className="text-[10px] uppercase tracking-[.12em] text-emerald-300">Новое событие</div>
        <div className="mt-1">{activity[activityIndex]}</div>
      </div>

      <style jsx>{`
        .dealer-demo-shell {
          --demo-panel: #10131b;
          --demo-card: #181c25;
          --demo-soft: rgba(255,255,255,.055);
          --demo-avatar: rgba(255,255,255,.1);
          --demo-text: #ffffff;
          --demo-muted: rgba(255,255,255,.48);
          color: var(--demo-text);
        }
        .dealer-demo-fade { animation: dealerDemoFade .5s ease both; }
        @keyframes dealerDemoFade { from { opacity: .25; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        :global(html[data-theme="light"]) .dealer-demo-shell {
          --demo-panel: #ffffff;
          --demo-card: #f1f4f8;
          --demo-soft: #e5eaf1;
          --demo-avatar: #d8dee8;
          --demo-text: #171b23;
          --demo-muted: #647086;
        }
        :global(html[data-theme="light"]) .dealer-demo-window { border: 1px solid rgba(31,38,51,.08); }
        @media (prefers-reduced-motion: reduce) { .dealer-demo-fade { animation: none; } }
      `}</style>
    </div>
  );
}
