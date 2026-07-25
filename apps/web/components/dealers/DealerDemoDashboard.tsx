"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

const navItems = ["Обзор", "Заявки", "Клиенты", "Команда", "Рынки", "Компания"] as const;
type NavItem = (typeof navItems)[number];
type LeadTone = "new" | "work" | "ready" | "deal" | "late";

const leadPool = [
  { id: 1, city: "Новокузнецк", client: "Алексей", car: "Кроссовер до 2 млн ₽", source: "Сайт", status: "Новая", tone: "new", time: "1 мин" },
  { id: 2, city: "Кемерово", client: "Марина", car: "Honda Fit из Японии", source: "Telegram", status: "В работе", tone: "work", time: "6 мин" },
  { id: 3, city: "Барнаул", client: "Олег", car: "Новый Geely до 3 млн ₽", source: "Сайт", status: "Расчёт", tone: "ready", time: "18 мин" },
  { id: 4, city: "Томск", client: "Ирина", car: "Kia Sorento из Кореи", source: "Рекомендация", status: "Сделка", tone: "deal", time: "сегодня" },
  { id: 5, city: "Новосибирск", client: "Денис", car: "BMW 3 из Китая", source: "Telegram", status: "Без ответа", tone: "late", time: "24 мин" },
] as const satisfies ReadonlyArray<{ id: number; city: string; client: string; car: string; source: string; status: string; tone: LeadTone; time: string }>;

const managers = [
  { name: "Иван Чумаков", role: "Менеджер", count: "8 заявок", avatar: "/avatars/manager-red.webp", conversion: "31%", response: "7 мин" },
  { name: "Антон Молодых", role: "Администратор", count: "5 заявок", avatar: "/avatars/manager-yellow.webp", conversion: "42%", response: "5 мин" },
  { name: "Мария Орлова", role: "Менеджер", count: "4 заявки", avatar: "/avatars/manager-green.webp", conversion: "36%", response: "8 мин" },
] as const;

const markets = [
  ["🇯🇵", "Япония", "438", "31 заявка"],
  ["🇨🇳", "Китай", "291", "24 заявки"],
  ["🇰🇷", "Корея", "175", "19 заявок"],
  ["🇦🇪", "ОАЭ", "86", "11 заявок"],
  ["🇪🇺", "Европа", "663", "17 заявок"],
  ["🇬🇪", "Грузия", "42", "5 заявок"],
  ["🇰🇬", "Кыргызстан", "19", "3 заявки"],
] as const;

const clients = [
  ["Алексей Петров", "Новокузнецк", "до 2 млн ₽", "Связаться сегодня", "Кроссовер"],
  ["Марина Волкова", "Кемерово", "до 1,4 млн ₽", "Отправлено 4 варианта", "Honda Fit"],
  ["Олег Смирнов", "Барнаул", "до 3 млн ₽", "Ждём решение", "Geely"],
  ["Ирина Котова", "Томск", "до 3,5 млн ₽", "Договор подписан", "Kia Sorento"],
] as const;

const activity = [
  { text: "Запрошен расчёт Toyota Corolla из Японии", type: "request", imageIndex: 0 },
  { text: "Клиент выбрал новый Geely из Китая", type: "request", imageIndex: 1 },
  { text: "Появился новый отзыв после выдачи автомобиля", type: "review", fallback: "/buyers/8.jpg" },
  { text: "Автомобиль клиента прибыл во Владивосток", type: "delivery", fallback: "/buyers/11.jpg" },
] as const;

const graph = [
  { total: 34, confirmed: 0 }, { total: 46, confirmed: 5 }, { total: 38, confirmed: 0 }, { total: 67, confirmed: 8 },
  { total: 54, confirmed: 6 }, { total: 86, confirmed: 12 }, { total: 72, confirmed: 0 }, { total: 95, confirmed: 10 },
  { total: 79, confirmed: 7 }, { total: 108, confirmed: 14 }, { total: 93, confirmed: 9 }, { total: 120, confirmed: 16 },
] as const;

const statusClasses: Record<LeadTone, string> = {
  new: "demo-status--new",
  work: "demo-status--work",
  ready: "demo-status--ready",
  deal: "demo-status--deal",
  late: "demo-status--late",
};

const funnelMeta: Record<"Новые" | "В работе" | "Расчёт" | "Сделка", { tone: LeadTone; className: string }> = {
  "Новые": { tone: "new", className: "demo-funnel--new" },
  "В работе": { tone: "work", className: "demo-funnel--work" },
  "Расчёт": { tone: "ready", className: "demo-funnel--ready" },
  "Сделка": { tone: "deal", className: "demo-funnel--deal" },
};

function VerifiedIcon({ className = "", positive = false }: { className?: string; positive?: boolean }) {
  return (
    <span className={`dealer-verified-icon ${positive ? "dealer-verified-icon--positive" : ""} grid place-items-center ${className}`} aria-label="Проверено АвтоЦена" title="Проверено АвтоЦена">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 2.5L14.7 4.1L17.8 4.3L19.3 7L22 8.5L21.8 11.6L23.4 14.3L21.5 16.8L21 19.9L17.9 20.4L15.4 22.3L12.7 20.7L9.6 20.5L8.1 17.8L5.4 16.3L5.6 13.2L4 10.5L5.9 8L6.4 4.9L9.5 4.4L12 2.5Z" fill="currentColor" />
        <path d="M8.2 12.2L10.7 14.7L16.2 9.2" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function LeadRow({ lead }: { lead: (typeof leadPool)[number] }) {
  return (
    <article className="grid gap-3 rounded-2xl bg-[var(--demo-soft)] p-3.5 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--demo-avatar)] text-sm font-black">{lead.client.slice(0, 1)}</div>
        <div className="min-w-0">
          <div className="truncate text-sm font-black">{lead.client} · {lead.city}</div>
          <div className="mt-1 truncate text-xs font-bold text-[var(--demo-muted)]">{lead.car} · {lead.source} · {lead.time}</div>
        </div>
      </div>
      <span className={`demo-status w-fit rounded-full px-3 py-1.5 text-[11px] font-black ${statusClasses[lead.tone]}`}>{lead.status}</span>
    </article>
  );
}

function Panel({ title, subtitle, children, action }: { title: string; subtitle: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-[1.6rem] bg-[var(--demo-card)] p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-2xl font-black">{title}</h2><p className="mt-1 text-xs font-bold text-[var(--demo-muted)]">{subtitle}</p></div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function catalogImageFromOffer(offer: any) {
  const images = Array.isArray(offer?.images) ? offer.images : [];
  return String(images[0] || offer?.imageUrl || offer?.image || offer?.media?.[0]?.url || "");
}

export function DealerDemoDashboard() {
  const [activeNav, setActiveNav] = useState<NavItem>("Обзор");
  const [leadOffset, setLeadOffset] = useState(0);
  const [activityIndex, setActivityIndex] = useState(0);
  const [toastVisible, setToastVisible] = useState(true);
  const [catalogImages, setCatalogImages] = useState<string[]>([]);

  const visibleLeads = useMemo(() => leadPool.map((_, index) => leadPool[(index + leadOffset) % leadPool.length]).slice(0, 4), [leadOffset]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/catalog/search?pageSize=8&_=${Date.now()}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (cancelled) return;
        const rows = Array.isArray(data?.items) ? data.items : Array.isArray(data?.offers) ? data.offers : [];
        const images = rows.map(catalogImageFromOffer).filter(Boolean).slice(0, 6);
        setCatalogImages(images);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setLeadOffset((value) => (value + 1) % leadPool.length);
      setActivityIndex((value) => (value + 1) % activity.length);
      setToastVisible(true);
      window.setTimeout(() => setToastVisible(false), 4200);
    }, 9000);
    return () => window.clearInterval(timer);
  }, []);

  const currentActivity = activity[activityIndex];
  const activityImage = currentActivity.type === "request"
    ? catalogImages[currentActivity.imageIndex] || catalogImages[0] || "/buyers/2.jpg"
    : currentActivity.fallback;

  function mainContent() {
    if (activeNav === "Заявки") {
      const columns = [
        ["Новые", leadPool.filter((lead) => lead.tone === "new" || lead.tone === "late")],
        ["В работе", leadPool.filter((lead) => lead.tone === "work")],
        ["Расчёт", leadPool.filter((lead) => lead.tone === "ready")],
        ["Сделка", leadPool.filter((lead) => lead.tone === "deal")],
      ] as const;
      return (
        <Panel title="Воронка заявок" subtitle="Перетаскивание и автоматические статусы в рабочем кабинете">
          <div className="grid gap-3 lg:grid-cols-4">
            {columns.map(([title, rows]) => {
              const meta = funnelMeta[title];
              return (
                <div key={title} className={`demo-funnel-column ${meta.className} rounded-2xl p-3`}>
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-black">{title}</span>
                    <span className={`demo-status rounded-full px-2.5 py-1 text-[10px] font-black ${statusClasses[meta.tone]}`}>{rows.length}</span>
                  </div>
                  <div className="grid gap-2">
                    {rows.map((lead) => (
                      <div key={lead.id} className={`demo-funnel-card ${meta.className} rounded-xl p-3`}>
                        <div className="text-sm font-black">{lead.client}</div>
                        <div className="mt-1 text-xs font-bold leading-5 text-[var(--demo-muted)]">{lead.car}<br />{lead.city} · {lead.time}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      );
    }

    if (activeNav === "Клиенты") {
      return <Panel title="Клиентская база" subtitle="История запросов, бюджет и следующий шаг"><div className="grid gap-2">{clients.map(([name, city, budget, next, car]) => <article key={name} className="grid gap-3 rounded-2xl bg-[var(--demo-soft)] p-4 sm:grid-cols-[1.2fr_.8fr_.8fr] sm:items-center"><div><div className="font-black">{name}</div><div className="mt-1 text-xs font-bold text-[var(--demo-muted)]">{city} · интерес: {car}</div></div><div><div className="text-[10px] font-black uppercase tracking-[.1em] text-[var(--demo-muted)]">Бюджет</div><div className="mt-1 text-sm font-black">{budget}</div></div><div className="rounded-xl bg-[var(--demo-card)] px-3 py-2 text-xs font-black">{next}</div></article>)}</div></Panel>;
    }

    if (activeNav === "Команда") {
      return <Panel title="Команда и показатели" subtitle="В демо фирменные аватарки показываются всегда"><div className="grid gap-3 md:grid-cols-3">{managers.map((manager) => <article key={manager.name} className="rounded-2xl bg-[var(--demo-soft)] p-4 text-center"><img src={manager.avatar} alt="" className="mx-auto h-20 w-20 rounded-full object-cover" /><div className="mt-3 font-black">{manager.name}</div><div className="mt-1 text-xs font-bold text-[var(--demo-muted)]">{manager.role}</div><div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-xl bg-[var(--demo-card)] p-2"><div className="text-lg font-black">{manager.conversion}</div><div className="text-[10px] font-bold text-[var(--demo-muted)]">конверсия</div></div><div className="rounded-xl bg-[var(--demo-card)] p-2"><div className="text-lg font-black">{manager.response}</div><div className="text-[10px] font-bold text-[var(--demo-muted)]">ответ</div></div></div></article>)}</div></Panel>;
    }

    if (activeNav === "Рынки") {
      return <Panel title="Рынки и расчёт" subtitle="Единые правила расчёта и настройки компании"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{markets.map(([flag, name, cars, leads]) => <article key={name} className="rounded-2xl bg-[var(--demo-soft)] p-4"><div className="flex items-center justify-between"><span className="text-2xl">{flag}</span><span className="h-2 w-2 rounded-full bg-[var(--demo-positive)]" /></div><div className="mt-3 text-lg font-black">{name}</div><div className="mt-3 text-3xl font-black">{cars}</div><div className="mt-1 text-xs font-bold text-[var(--demo-muted)]">автомобилей · {leads}</div></article>)}</div></Panel>;
    }

    if (activeNav === "Компания") {
      return (
        <Panel title="Профиль компании" subtitle="Карточка, Telegram-лента, отзывы и города работы">
          <div className="grid gap-4 lg:grid-cols-[1fr_.9fr]">
            <article className="relative rounded-2xl bg-[var(--demo-soft)] p-5">
              <VerifiedIcon className="absolute right-4 top-4 h-11 w-11" />
              <div className="flex items-center gap-4"><div className="grid h-16 w-28 place-items-center rounded-2xl bg-[#0c0e14] p-3"><img src="/brands/topavto-logo.png" alt="TopAvto" className="max-h-full max-w-full object-contain" /></div><div><div className="text-xl font-black">TopAvto</div><div className="mt-1 text-xs font-bold text-[var(--demo-muted)]">Новокузнецк · проверенный дилер</div></div></div>
              <div className="mt-5 grid grid-cols-3 gap-2">{[["4,9", "рейтинг"], ["128", "выдач"], ["8 мин", "ответ"]].map(([value, label]) => <div key={label} className="rounded-xl bg-[var(--demo-card)] p-3 text-center"><div className="text-xl font-black">{value}</div><div className="text-[10px] font-bold text-[var(--demo-muted)]">{label}</div></div>)}</div>
            </article>
            <article className="rounded-2xl bg-[var(--demo-soft)] p-5">
              <div className="text-sm font-black">Подключённые возможности</div>
              <div className="mt-4 grid gap-2">{["Telegram-лента", "Отзывы после сделки", "Распределение заявок", "7 рынков", "Шапка и логотип"].map((item) => <div key={item} className="flex items-center gap-2 rounded-xl bg-[var(--demo-card)] px-3 py-2 text-sm font-bold"><VerifiedIcon positive className="h-5 w-5 shrink-0" />{item}</div>)}</div>
            </article>
          </div>
        </Panel>
      );
    }

    return <Panel title="Последние заявки" subtitle="Живая очередь компании" action={<button type="button" onClick={() => setLeadOffset((value) => (value + 1) % leadPool.length)} className="rounded-xl bg-[var(--demo-soft)] px-3 py-2 text-xs font-black">Обновить</button>}><div key={leadOffset} className="grid gap-2 dealer-demo-fade">{visibleLeads.map((lead) => <LeadRow key={`${lead.id}-${leadOffset}`} lead={lead} />)}</div></Panel>;
  }

  return (
    <div className="dealer-demo-shell mx-auto w-full max-w-[1500px] px-4 pb-14 pt-7 md:px-8 md:pb-20 md:pt-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div><div className="text-sm font-black uppercase tracking-[.18em] text-red-400">Демо без регистрации</div><h1 className="mt-2 text-4xl font-black tracking-[-.05em] md:text-6xl">Посмотрите CRM изнутри</h1><p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-[var(--demo-muted)] md:text-base">Все данные демонстрационные. Откройте каждый раздел и оцените полноценный рабочий кабинет компании.</p></div>
        <Link href="/dealers#connect" className="dealer-primary-button rounded-2xl bg-red-500 px-6 py-4 text-sm font-black text-white">Подключить компанию</Link>
      </div>

      <section className="dealer-demo-window overflow-hidden rounded-[2rem] bg-[var(--demo-panel)]">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/7 px-4 py-4 md:px-6">
          <div className="flex items-center gap-3"><div className="grid h-12 w-24 place-items-center rounded-2xl bg-[#0c0e14] p-2"><img src="/brands/topavto-logo.png" alt="TopAvto" className="max-h-full max-w-full object-contain" /></div><div><div className="font-black">TopAvto · демо</div><div className="text-xs font-bold text-[var(--demo-muted)]">Новокузнецк · 7 рынков</div></div></div>
          <div className="flex items-center gap-2"><span className="demo-online-chip hidden rounded-full px-3 py-2 text-xs font-black sm:inline-flex">● Система работает</span><img src="/avatars/manager-blue.webp" alt="Демо-пользователь" className="h-10 w-10 rounded-full object-cover" /></div>
        </header>

        <nav className="flex gap-2 overflow-x-auto border-b border-white/7 px-4 py-3 [scrollbar-width:none] md:px-6" aria-label="Демо-разделы">
          {navItems.map((item) => <button key={item} type="button" onClick={() => setActiveNav(item)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-black transition ${activeNav === item ? "dealer-primary-button bg-red-500 text-white" : "bg-[var(--demo-soft)] text-[var(--demo-muted)] hover:text-[var(--demo-text)]"}`}>{item}</button>)}
        </nav>

        <div className="grid gap-4 p-4 md:p-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[["Новые заявки", "18", "+4 сегодня"], ["Без ответа", "3", "нужен ответ"], ["В работе", "47", "6 менеджеров"], ["В пути", "12", "2 скоро выдача"]].map(([label, value, note]) => <article key={label} className="demo-metric-card rounded-[1.5rem] bg-[var(--demo-card)] p-4 md:p-5"><div className="text-xs font-bold text-[var(--demo-muted)]">{label}</div><div className="mt-2 text-3xl font-black md:text-4xl">{value}</div><div className="mt-2 text-[11px] font-black text-red-400">{note}</div></article>)}</div>
            {mainContent()}
          </div>

          <aside className="space-y-4">
            <section className="rounded-[1.6rem] bg-[var(--demo-card)] p-5">
              <div className="flex items-center justify-between"><h2 className="text-xl font-black">Команда</h2><span className="text-xs font-black text-[var(--demo-positive)]">6 онлайн</span></div>
              <div className="mt-4 grid gap-3">{managers.map((manager) => <button key={manager.name} type="button" onClick={() => setActiveNav("Команда")} className="flex w-full items-center justify-between rounded-2xl bg-[var(--demo-soft)] p-3 text-left"><div className="flex items-center gap-3"><img src={manager.avatar} alt="" className="h-10 w-10 rounded-full object-cover" /><div><div className="text-sm font-black">{manager.name}</div><div className="text-xs font-bold text-[var(--demo-muted)]">онлайн</div></div></div><span className="text-xs font-black text-[var(--demo-muted)]">{manager.count}</span></button>)}</div>
            </section>

            <section className="rounded-[1.6rem] bg-[var(--demo-card)] p-5">
              <div className="flex items-center justify-between"><h2 className="text-xl font-black">Сегодня</h2><span className="text-xs font-black text-[var(--demo-positive)]">+12%</span></div>
              <div className="mt-4 flex h-32 items-end gap-2" aria-label="График заявок и подтверждений">{graph.map((bar, index) => <span key={index} className="flex flex-1 flex-col overflow-hidden rounded-t-[2px]" style={{ height: bar.total }} title={`${bar.total} заявок, ${bar.confirmed} подтверждено`}>{bar.confirmed ? <i className="block shrink-0 bg-[var(--demo-positive)]" style={{ height: bar.confirmed }} /> : null}<i className="block min-h-0 flex-1 bg-red-500/80" /></span>)}</div>
              <div className="mt-3 flex justify-between text-[10px] font-bold text-[var(--demo-muted)]"><span>09:00</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[var(--demo-positive)]" />подтверждено</span><span>Сейчас</span></div>
            </section>
          </aside>
        </div>
      </section>

      <div className={`dealer-demo-toast pointer-events-none fixed bottom-5 right-5 z-[6000] flex max-w-[360px] items-center gap-3 rounded-2xl bg-[#12151d] p-3 text-sm font-black text-white transition duration-500 ${toastVisible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"}`}>
        <img src={activityImage} alt="" className="h-16 w-20 shrink-0 rounded-xl object-cover" />
        <div><div className="text-[10px] uppercase tracking-[.12em] text-[var(--demo-positive)]">{currentActivity.type === "review" ? "Новый отзыв" : currentActivity.type === "delivery" ? "Этап доставки" : "Новый запрос"}</div><div className="mt-1 leading-5">{currentActivity.text}</div></div>
      </div>

      <style jsx>{`
        .dealer-demo-shell {
          --demo-panel: #10131b;
          --demo-card: #181c25;
          --demo-soft: rgba(255,255,255,.065);
          --demo-avatar: rgba(255,255,255,.12);
          --demo-text: #ffffff;
          --demo-muted: rgba(255,255,255,.58);
          --demo-positive: #20a85e;
          color: var(--demo-text);
        }
        .demo-online-chip { background: rgba(32,168,94,.18); color: var(--demo-positive); }
        .dealer-demo-fade { animation: dealerDemoFade .5s ease both; }
        .demo-funnel-column { border: 1px solid transparent; border-top-width: 4px; }
        .demo-funnel-card { border-left: 4px solid transparent; background: var(--demo-card); }
        .demo-funnel--new { border-color: #20a85e; background-color: rgba(32,168,94,.10); }
        .demo-funnel--work { border-color: #d9a700; background-color: rgba(217,167,0,.10); }
        .demo-funnel--ready { border-color: #169ed1; background-color: rgba(22,158,209,.10); }
        .demo-funnel--deal { border-color: #ef3340; background-color: rgba(239,51,64,.10); }
        @keyframes dealerDemoFade { from { opacity: .25; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        :global(html[data-theme="light"]) .dealer-demo-shell {
          --demo-panel: #ffffff;
          --demo-card: #eef2f7;
          --demo-soft: #dde4ed;
          --demo-avatar: #cfd8e5;
          --demo-text: #171b23;
          --demo-muted: #536176;
          --demo-positive: #20a85e;
        }
        :global(html[data-theme="light"]) .dealer-demo-window { border: 1px solid rgba(31,38,51,.08); }
        :global(html[data-theme="light"]) .demo-funnel--new { background-color: rgba(32,168,94,.12); }
        :global(html[data-theme="light"]) .demo-funnel--work { background-color: rgba(217,167,0,.12); }
        :global(html[data-theme="light"]) .demo-funnel--ready { background-color: rgba(22,158,209,.12); }
        :global(html[data-theme="light"]) .demo-funnel--deal { background-color: rgba(239,51,64,.12); }
        @media (prefers-reduced-motion: reduce) { .dealer-demo-fade { animation: none; } }
      `}</style>
    </div>
  );
}
