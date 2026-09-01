"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

const navItems = ["Обзор", "Заявки", "Клиенты", "Команда", "Рынки", "Компания"] as const;
type NavItem = (typeof navItems)[number];
type LeadTone = "new" | "work" | "ready" | "deal" | "late";
type DemoMarketId = "japan" | "china" | "korea" | "uae" | "europe" | "georgia";

const leadPool = [
  { id: 1, city: "Новокузнецк", client: "Алексей", car: "Кроссовер до 2 млн ₽", source: "Сайт", status: "Новая", tone: "new", time: "1 мин" },
  { id: 2, city: "Кемерово", client: "Марина", car: "Honda Fit из Японии", source: "Telegram", status: "В работе", tone: "work", time: "6 мин" },
  { id: 3, city: "Барнаул", client: "Олег", car: "Новый Geely до 3 млн ₽", source: "Сайт", status: "Расчёт", tone: "ready", time: "18 мин" },
  { id: 4, city: "Томск", client: "Ирина", car: "Kia Sorento из Кореи", source: "Рекомендация", status: "Сделка", tone: "deal", time: "сегодня" },
  { id: 5, city: "Новосибирск", client: "Денис", car: "BMW 3 из Китая", source: "Telegram", status: "Без ответа", tone: "late", time: "24 мин" },
  { id: 6, city: "Новокузнецк", client: "Сергей", car: "Toyota RAV4 до 2,5 млн ₽", source: "Сайт", status: "В работе", tone: "work", time: "38 мин" },
  { id: 7, city: "Красноярск", client: "Евгений", car: "Kia Sportage из Кореи", source: "Telegram", status: "Расчёт", tone: "ready", time: "45 мин" },
  { id: 8, city: "Москва", client: "Дмитрий", car: "Lexus RX до 6 млн ₽", source: "Сайт", status: "Сделка", tone: "deal", time: "сегодня" },
] as const satisfies ReadonlyArray<{ id: number; city: string; client: string; car: string; source: string; status: string; tone: LeadTone; time: string }>;

const managers = [
  { name: "Иван Чумаков", role: "Менеджер", count: "8 заявок", avatar: "/avatars/manager-red.webp", conversion: "31%", response: "7 мин" },
  { name: "Антон Молодых", role: "Администратор", count: "5 заявок", avatar: "/avatars/manager-yellow.webp", conversion: "42%", response: "5 мин" },
  { name: "Мария Орлова", role: "Менеджер", count: "4 заявки", avatar: "/avatars/manager-green.webp", conversion: "36%", response: "8 мин" },
] as const;

const markets = [
  { id: "japan", flag: "🇯🇵", name: "Япония", leads: "31 заявка" },
  { id: "china", flag: "🇨🇳", name: "Китай", leads: "24 заявки" },
  { id: "korea", flag: "🇰🇷", name: "Корея", leads: "19 заявок" },
  { id: "uae", flag: "🇦🇪", name: "ОАЭ", leads: "11 заявок" },
  { id: "europe", flag: "🇪🇺", name: "Европа", leads: "17 заявок" },
  { id: "georgia", flag: "🇬🇪", name: "Грузия", leads: "5 заявок" },
] as const satisfies ReadonlyArray<{ id: DemoMarketId; flag: string; name: string; leads: string }>;

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

const countFormatter = new Intl.NumberFormat("ru-RU");

function MarketFlag({ market }: { market: DemoMarketId }) {
  const common = "block h-5 w-7 shrink-0 overflow-hidden rounded-[4px] border border-black/10 shadow-[0_1px_2px_rgba(0,0,0,.12)]";
  if (market === "japan") return <svg viewBox="0 0 28 20" className={common} role="img" aria-label="Флаг Японии"><rect width="28" height="20" fill="#fff" /><circle cx="14" cy="10" r="5" fill="#bc002d" /></svg>;
  if (market === "china") return <svg viewBox="0 0 28 20" className={common} role="img" aria-label="Флаг Китая"><rect width="28" height="20" fill="#de2910" /><polygon points="6,3 7.1,5.4 9.8,5.6 7.7,7.3 8.4,10 6,8.5 3.6,10 4.3,7.3 2.2,5.6 4.9,5.4" fill="#ffde00" /></svg>;
  if (market === "korea") return <svg viewBox="0 0 28 20" className={common} role="img" aria-label="Флаг Южной Кореи"><rect width="28" height="20" fill="#fff" /><circle cx="14" cy="10" r="4.2" fill="#cd2e3a" /><path d="M9.8 10a4.2 4.2 0 0 0 8.4 0c-2.1-1.9-4.2 1.9-6.3 0-1.05-.95-1.4-.95-2.1 0Z" fill="#0047a0" /></svg>;
  if (market === "uae") return <svg viewBox="0 0 28 20" className={common} role="img" aria-label="Флаг ОАЭ"><rect width="28" height="20" fill="#fff" /><rect width="28" height="6.67" fill="#00732f" /><rect y="13.33" width="28" height="6.67" fill="#000" /><rect width="7" height="20" fill="#ff0000" /></svg>;
  if (market === "europe") return <svg viewBox="0 0 28 20" className={common} role="img" aria-label="Флаг Европейского союза"><rect width="28" height="20" fill="#003399" />{Array.from({ length: 12 }, (_, index) => { const angle = index * Math.PI / 6 - Math.PI / 2; return <circle key={index} cx={14 + Math.cos(angle) * 5.2} cy={10 + Math.sin(angle) * 5.2} r=".7" fill="#ffcc00" />; })}</svg>;
  return <svg viewBox="0 0 28 20" className={common} role="img" aria-label="Флаг Грузии"><rect width="28" height="20" fill="#fff" /><rect x="12" width="4" height="20" fill="#ff0000" /><rect y="8" width="28" height="4" fill="#ff0000" /></svg>;
}

function VerifiedIcon({ className = "", positive = false }: { className?: string; positive?: boolean }) {
  return (
    <span className={`dealer-verified-icon ${positive ? "dealer-verified-icon--positive" : ""} inline-grid place-items-center ${className}`} aria-label="Проверено АвтоЦена" title="Проверено АвтоЦена">
      <svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 2.25l2.15 1.55 2.64-.17.98 2.46 2.35 1.23-.47 2.61 1.16 2.39-1.78 1.98-.08 2.66-2.56.74-1.38 2.27-2.67-.66L10 20.72l-2.34-1.37-2.67.66-1.38-2.27-2.56-.74-.08-2.66L-.81 12.36.35 9.97-.12 7.36l2.35-1.23.98-2.46 2.64.17L8 2.25 12 .8l4 1.45Z" transform="translate(0 1.2) scale(.92)" fill="currentColor" />
        <path d="M7.8 12.1l2.6 2.55 5.8-5.7" stroke="white" strokeWidth="2.15" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function TopAvtoLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`topavto-logo ${compact ? "topavto-logo--compact" : ""}`} aria-label="TopAvto">
      <svg viewBox="0 0 190 58" role="img" aria-hidden="true">
        <path d="M18 28c20-18 44-22 74-20 26 2 48 10 72 27" fill="none" stroke="#ef3340" strokeWidth="5" strokeLinecap="round" />
        <path d="M28 31h126" fill="none" stroke="#ef3340" strokeWidth="3" strokeLinecap="round" opacity=".75" />
        <text x="18" y="52" fontSize="23" fontWeight="900" fontFamily="Arial, sans-serif"><tspan fill="#ef3340">TOP</tspan><tspan fill="currentColor">AVTO</tspan></text>
      </svg>
    </div>
  );
}

function DemoAvatar() {
  return (
    <span className="demo-user-avatar" aria-label="Демо-пользователь">
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="24" fill="#d9eaff" />
        <path d="M11 45c1.8-9.3 7-14 13-14s11.2 4.7 13 14" fill="#1779df" />
        <circle cx="24" cy="20" r="9" fill="#f1b37f" />
        <path d="M15.7 19.3c.2-7.5 4-11.5 9.3-11.5 5.6 0 8.4 4.3 8 11.2-2.3-4.4-6.6-6.6-12.7-5.5-1.4 2.6-2.9 4.4-4.6 5.8Z" fill="#185ca8" />
        <circle cx="21" cy="20" r="1" fill="#282d35" /><circle cx="27" cy="20" r="1" fill="#282d35" />
        <path d="M21 24.5c1.8 1.4 4.2 1.4 6 0" fill="none" stroke="#9d563c" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function LeadRow({ lead }: { lead: (typeof leadPool)[number] }) {
  return (
    <article className="grid gap-3 rounded-2xl bg-[var(--demo-soft)] p-3.5 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--demo-avatar)] text-sm font-black">{lead.client.slice(0, 1)}</div>
        <div className="min-w-0"><div className="truncate text-sm font-black">{lead.client} · {lead.city}</div><div className="mt-1 truncate text-xs font-bold text-[var(--demo-muted)]">{lead.car} · {lead.source} · {lead.time}</div></div>
      </div>
      <span className={`demo-status w-fit rounded-full px-3 py-1.5 text-[11px] font-black ${statusClasses[lead.tone]}`}>{lead.status}</span>
    </article>
  );
}

function Panel({ title, subtitle, children, action }: { title: string; subtitle: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-[1.6rem] bg-[var(--demo-card)] p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-black">{title}</h2><p className="mt-1 text-xs font-bold text-[var(--demo-muted)]">{subtitle}</p></div>{action}</div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function catalogImageFromOffer(offer: any) {
  const images = Array.isArray(offer?.images) ? offer.images : [];
  const objectImage = images.find((image: any) => image && typeof image === "object" && typeof image.url === "string");
  const stringImage = images.find((image: any) => typeof image === "string");
  return String(objectImage?.url || stringImage || offer?.imageUrl || offer?.image?.url || offer?.image || offer?.media?.[0]?.url || "").trim();
}

export function DealerDemoDashboard() {
  const [activeNav, setActiveNav] = useState<NavItem>("Обзор");
  const [leadOffset, setLeadOffset] = useState(0);
  const [activityIndex, setActivityIndex] = useState(0);
  const [toastVisible, setToastVisible] = useState(true);
  const [catalogImages, setCatalogImages] = useState<string[]>([]);
  const [marketCounts, setMarketCounts] = useState<Partial<Record<DemoMarketId, number>>>({});
  const [catalogUpdatedAt, setCatalogUpdatedAt] = useState("");

  const visibleLeads = useMemo(() => leadPool.map((_, index) => leadPool[(index + leadOffset) % leadPool.length]).slice(0, 4), [leadOffset]);
  const publishedMarketTotal = useMemo(() => markets.reduce((sum, market) => sum + Number(marketCounts[market.id] || 0), 0), [marketCounts]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/catalog/search?pageSize=24&_=${Date.now()}`, { cache: "no-store" }).then((response) => response.ok ? response.json() : null),
      fetch(`/api/catalog/market-counts?_=${Date.now()}`, { cache: "no-store" }).then((response) => response.ok ? response.json() : null),
    ])
      .then(([catalogData, countsData]) => {
        if (cancelled) return;
        const rows: any[] = Array.isArray(catalogData?.items) ? catalogData.items : Array.isArray(catalogData?.offers) ? catalogData.offers : [];
        const candidates: string[] = rows
          .map((offer) => catalogImageFromOffer(offer))
          .filter((url): url is string => Boolean(url) && (/^https?:\/\//.test(url) || url.startsWith("/api/catalog/images/")));
        setCatalogImages(Array.from(new Set<string>(candidates)).slice(0, 12));

        const counts = countsData?.markets && typeof countsData.markets === "object" ? countsData.markets : {};
        setMarketCounts(Object.fromEntries(markets.map((market) => [market.id, Math.max(0, Number(counts[market.id] || 0))])) as Record<DemoMarketId, number>);
        setCatalogUpdatedAt(String(countsData?.updatedAt || ""));
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
  const activityImage = currentActivity.type === "request" ? catalogImages[currentActivity.imageIndex] || catalogImages[0] || "" : currentActivity.fallback;
  const canShowToast = currentActivity.type !== "request" || Boolean(activityImage);

  function mainContent() {
    if (activeNav === "Заявки") {
      const columns = [
        ["Новые", leadPool.filter((lead) => lead.tone === "new" || lead.tone === "late")],
        ["В работе", leadPool.filter((lead) => lead.tone === "work")],
        ["Расчёт", leadPool.filter((lead) => lead.tone === "ready")],
        ["Сделка", leadPool.filter((lead) => lead.tone === "deal")],
      ] as const;
      return (
        <Panel title="Воронка заявок" subtitle="Каждый этап отделён цветом и отдельной колонкой — статусы считываются сразу">
          <div className="demo-funnel-grid grid gap-4 lg:grid-cols-4">
            {columns.map(([title, rows]) => {
              const meta = funnelMeta[title];
              return (
                <section key={title} className={`demo-funnel-column ${meta.className} rounded-2xl p-3.5`}>
                  <div className="mb-3 flex items-center justify-between"><span className="text-sm font-black">{title}</span><span className={`demo-status rounded-full px-2.5 py-1 text-[10px] font-black ${statusClasses[meta.tone]}`}>{rows.length}</span></div>
                  <div className="grid gap-2.5">{rows.map((lead) => <article key={lead.id} className="demo-funnel-card rounded-xl p-3.5"><div className="flex items-start justify-between gap-2"><div className="text-sm font-black">{lead.client}</div><span className="text-[13px] font-black text-[var(--demo-muted)]">⋮</span></div><div className="mt-2 text-xs font-bold leading-5 text-[var(--demo-muted)]">{lead.car}</div><div className="mt-3 text-[11px] font-black text-[var(--demo-muted)]">{lead.city} · {lead.time}</div></article>)}</div>
                </section>
              );
            })}
          </div>
        </Panel>
      );
    }

    if (activeNav === "Клиенты") return <Panel title="Клиентская база" subtitle="История запросов, бюджет и следующий шаг"><div className="grid gap-2">{clients.map(([name, city, budget, next, car]) => <article key={name} className="grid gap-3 rounded-2xl bg-[var(--demo-soft)] p-4 sm:grid-cols-[1.2fr_.8fr_.8fr] sm:items-center"><div><div className="font-black">{name}</div><div className="mt-1 text-xs font-bold text-[var(--demo-muted)]">{city} · интерес: {car}</div></div><div><div className="text-[10px] font-black uppercase tracking-[.1em] text-[var(--demo-muted)]">Бюджет</div><div className="mt-1 text-sm font-black">{budget}</div></div><div className="rounded-xl bg-[var(--demo-panel)] px-3 py-2 text-xs font-black">{next}</div></article>)}</div></Panel>;

    if (activeNav === "Команда") return <Panel title="Команда и показатели" subtitle="В демо фирменные аватарки показываются всегда"><div className="grid gap-3 md:grid-cols-3">{managers.map((manager) => <article key={manager.name} className="rounded-2xl bg-[var(--demo-soft)] p-4 text-center"><img src={manager.avatar} alt="" className="mx-auto h-20 w-20 rounded-full object-cover" /><div className="mt-3 font-black">{manager.name}</div><div className="mt-1 text-xs font-bold text-[var(--demo-muted)]">{manager.role}</div><div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-xl bg-[var(--demo-panel)] p-2"><div className="text-lg font-black">{manager.conversion}</div><div className="text-[10px] font-bold text-[var(--demo-muted)]">конверсия</div></div><div className="rounded-xl bg-[var(--demo-panel)] p-2"><div className="text-lg font-black">{manager.response}</div><div className="text-[10px] font-bold text-[var(--demo-muted)]">ответ</div></div></div></article>)}</div></Panel>;

    if (activeNav === "Рынки") return <Panel title="Рынки и расчёт" subtitle={`Фактическое количество автомобилей в опубликованном каталоге${catalogUpdatedAt ? ` · обновлено ${new Date(catalogUpdatedAt).toLocaleString("ru-RU")}` : ""}`}><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{markets.map((market) => { const count = marketCounts[market.id]; return <article key={market.id} className="rounded-2xl bg-[var(--demo-soft)] p-4"><div className="flex items-center justify-between"><MarketFlag market={market.id} /><span className={`h-2 w-2 rounded-full ${Number(count || 0) > 0 ? "bg-[var(--demo-positive)]" : "bg-[var(--demo-muted)]"}`} /></div><div className="mt-3 text-lg font-black">{market.name}</div><div className="mt-3 text-3xl font-black">{count === undefined ? "—" : countFormatter.format(count)}</div><div className="mt-1 text-xs font-bold text-[var(--demo-muted)]">автомобилей в каталоге · {market.leads}</div></article>; })}</div></Panel>;

    if (activeNav === "Компания") {
      return (
        <Panel title="Профиль компании" subtitle="Карточка, Telegram-лента, отзывы и города работы">
          <div className="grid gap-4 lg:grid-cols-[1fr_.9fr]">
            <article className="rounded-2xl bg-[var(--demo-soft)] p-5">
              <div className="flex items-center gap-4"><TopAvtoLogo /><div className="min-w-0"><div className="flex items-center gap-2"><div className="truncate text-xl font-black">TopAvto</div><VerifiedIcon className="h-6 w-6 shrink-0" /></div><div className="mt-1 text-xs font-bold text-[var(--demo-muted)]">Новокузнецк · проверенный дилер</div></div></div>
              <div className="mt-5 grid grid-cols-3 gap-2">{[["4,9", "рейтинг"], ["128", "выдач"], ["8 мин", "ответ"]].map(([value, label]) => <div key={label} className="rounded-xl bg-[var(--demo-panel)] p-3 text-center"><div className="text-xl font-black">{value}</div><div className="text-[10px] font-bold text-[var(--demo-muted)]">{label}</div></div>)}</div>
              <a href="https://avtocena.com/topavto" className="mt-4 flex items-center justify-between border-t border-black/10 pt-4 text-sm font-bold text-[var(--demo-muted)]"><span>🌐 avtocena.com/topavto</span><span aria-hidden="true">↗</span></a>
            </article>
            <article className="rounded-2xl bg-[var(--demo-soft)] p-5"><div className="text-sm font-black">Подключённые возможности</div><div className="mt-4 grid gap-2">{["Telegram-лента", "Отзывы после сделки", "Распределение заявок", "6 рынков", "Шапка и логотип"].map((item) => <div key={item} className="flex items-center gap-2 rounded-xl bg-[var(--demo-panel)] px-3 py-2 text-sm font-bold"><VerifiedIcon positive className="h-5 w-5 shrink-0" />{item}</div>)}</div></article>
          </div>
        </Panel>
      );
    }

    return <Panel title="Последние заявки" subtitle="Живая очередь компании" action={<button type="button" onClick={() => setLeadOffset((value) => (value + 1) % leadPool.length)} className="rounded-xl bg-[var(--demo-soft)] px-3 py-2 text-xs font-black">Обновить</button>}><div key={leadOffset} className="grid gap-2 dealer-demo-fade">{visibleLeads.map((lead) => <LeadRow key={`${lead.id}-${leadOffset}`} lead={lead} />)}</div></Panel>;
  }

  return (
    <div className="dealer-demo-shell mx-auto w-full max-w-[1500px] px-4 pb-14 pt-7 md:px-8 md:pb-20 md:pt-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><div className="text-sm font-black uppercase tracking-[.18em] text-red-400">Демо без регистрации</div><h1 className="mt-2 text-4xl font-black tracking-[-.05em] md:text-6xl">Посмотрите CRM изнутри</h1><p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-[var(--demo-muted)] md:text-base">Заявки, сотрудники и показатели демонстрационные. Количество автомобилей по рынкам берётся из действующего опубликованного каталога.</p></div><Link href="/dealers#connect" className="dealer-primary-button rounded-2xl bg-red-500 px-6 py-4 text-sm font-black text-white">Подключить компанию</Link></div>

      <section className="dealer-demo-window overflow-hidden rounded-[2rem] bg-[var(--demo-panel)]">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/7 px-4 py-4 md:px-6">
          <div className="flex items-center gap-3"><TopAvtoLogo compact /><div><div className="font-black">TopAvto · демо</div><div className="text-xs font-bold text-[var(--demo-muted)]">Новокузнецк · 6 рынков{publishedMarketTotal > 0 ? ` · ${countFormatter.format(publishedMarketTotal)} авто` : ""}</div></div></div>
          <div className="flex items-center gap-3"><span className="demo-online-chip hidden rounded-full px-3 py-2 text-xs font-black sm:inline-flex">● Система работает</span><div className="flex items-center gap-2"><DemoAvatar /><span className="hidden text-sm font-black sm:inline">Демо</span></div></div>
        </header>

        <nav className="flex gap-2 overflow-x-auto border-b border-white/7 px-4 py-3 [scrollbar-width:none] md:px-6" aria-label="Демо-разделы">{navItems.map((item) => <button key={item} type="button" onClick={() => setActiveNav(item)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-black transition ${activeNav === item ? "dealer-primary-button bg-red-500 text-white" : "bg-[var(--demo-soft)] text-[var(--demo-muted)] hover:text-[var(--demo-text)]"}`}>{item}</button>)}</nav>

        <div className="grid gap-4 p-4 md:p-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4"><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[["Новые заявки", "18", "+4 сегодня"], ["Без ответа", "3", "нужен ответ"], ["В работе", "47", "6 менеджеров"], ["В пути", "12", "2 скоро выдача"]].map(([label, value, note]) => <article key={label} className="demo-metric-card rounded-[1.5rem] bg-[var(--demo-card)] p-4 md:p-5"><div className="text-xs font-bold text-[var(--demo-muted)]">{label}</div><div className="mt-2 text-3xl font-black md:text-4xl">{value}</div><div className="mt-2 text-[11px] font-black text-red-400">{note}</div></article>)}</div>{mainContent()}</div>

          <aside className="space-y-4">
            <section className="rounded-[1.6rem] bg-[var(--demo-card)] p-5"><div className="flex items-center justify-between"><h2 className="text-xl font-black">Команда</h2><span className="text-xs font-black text-[var(--demo-positive)]">6 онлайн</span></div><div className="mt-4 grid gap-3">{managers.map((manager) => <button key={manager.name} type="button" onClick={() => setActiveNav("Команда")} className="flex w-full items-center justify-between rounded-2xl bg-[var(--demo-soft)] p-3 text-left"><div className="flex items-center gap-3"><img src={manager.avatar} alt="" className="h-10 w-10 rounded-full object-cover" /><div><div className="text-sm font-black">{manager.name}</div><div className="text-xs font-bold text-[var(--demo-muted)]">онлайн</div></div></div><span className="text-xs font-black text-[var(--demo-muted)]">{manager.count}</span></button>)}</div></section>
            <section className="rounded-[1.6rem] bg-[var(--demo-card)] p-5"><div className="flex items-center justify-between"><h2 className="text-xl font-black">Сегодня</h2><span className="text-xs font-black text-[var(--demo-positive)]">+12%</span></div><div className="mt-4 flex h-32 items-end gap-2" aria-label="График заявок и подтверждений">{graph.map((bar, index) => <span key={index} className="flex flex-1 flex-col overflow-hidden rounded-t-[1px]" style={{ height: bar.total }} title={`${bar.total} заявок, ${bar.confirmed} подтверждено`}>{bar.confirmed ? <i className="block shrink-0 bg-[var(--demo-positive)]" style={{ height: bar.confirmed }} /> : null}<i className="block min-h-0 flex-1 bg-red-500/80" /></span>)}</div><div className="mt-3 flex justify-between text-[10px] font-bold text-[var(--demo-muted)]"><span>09:00</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[var(--demo-positive)]" />подтверждено</span><span>Сейчас</span></div></section>
          </aside>
        </div>
      </section>

      {canShowToast ? <div className={`dealer-demo-toast pointer-events-none fixed bottom-5 right-5 z-[6000] flex max-w-[360px] items-center gap-3 rounded-2xl bg-[#12151d] p-3 text-sm font-black text-white transition duration-500 ${toastVisible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"}`}><img key={activityImage} src={activityImage} alt="Автомобиль" className="h-16 w-20 shrink-0 rounded-xl object-cover" onError={() => { if (currentActivity.type === "request") setCatalogImages((images) => images.filter((image) => image !== activityImage)); }} /><div><div className="text-[10px] uppercase tracking-[.12em] text-[var(--demo-positive)]">{currentActivity.type === "review" ? "Новый отзыв" : currentActivity.type === "delivery" ? "Этап доставки" : "Новый запрос"}</div><div className="mt-1 leading-5">{currentActivity.text}</div></div></div> : null}

      <style jsx>{`
        .dealer-demo-shell{--demo-panel:#10131b;--demo-card:#181c25;--demo-soft:rgba(255,255,255,.065);--demo-avatar:rgba(255,255,255,.12);--demo-text:#fff;--demo-muted:rgba(255,255,255,.58);--demo-positive:#20a85e;color:var(--demo-text)}
        .topavto-logo{display:grid;width:112px;height:64px;place-items:center;border:1px solid rgba(23,27,35,.12);border-radius:16px;background:#fff;color:#141821;padding:8px}.topavto-logo svg{width:100%;height:100%}.topavto-logo--compact{width:86px;height:46px;border-radius:13px;padding:6px}
        .demo-user-avatar{display:block;width:40px;height:40px;overflow:hidden;border:2px solid rgba(23,121,223,.22);border-radius:999px;background:#d9eaff}.demo-user-avatar svg{display:block;width:100%;height:100%}
        .dealer-verified-icon{color:#ef3340}.dealer-verified-icon--positive{color:var(--demo-positive)}
        .demo-online-chip{background:rgba(32,168,94,.18);color:var(--demo-positive)}
        .dealer-demo-fade{animation:dealerDemoFade .5s ease both}
        .demo-funnel-column{min-height:250px;border:1px solid transparent;border-top-width:4px}.demo-funnel-card{border:1px solid rgba(255,255,255,.08);background:var(--demo-panel);box-shadow:0 8px 18px rgba(0,0,0,.08)}
        .demo-funnel--new{border-color:#20a85e;background-color:rgba(32,168,94,.10)}.demo-funnel--work{border-color:#d9a700;background-color:rgba(217,167,0,.10)}.demo-funnel--ready{border-color:#169ed1;background-color:rgba(22,158,209,.10)}.demo-funnel--deal{border-color:#ef3340;background-color:rgba(239,51,64,.10)}
        .demo-status--new{background:rgba(32,168,94,.16);color:#20a85e}.demo-status--work{background:rgba(217,167,0,.18);color:#d9a700}.demo-status--ready{background:rgba(22,158,209,.18);color:#169ed1}.demo-status--deal{background:rgba(239,51,64,.18);color:#ef3340}.demo-status--late{background:rgba(239,132,51,.18);color:#ef8433}
        @keyframes dealerDemoFade{from{opacity:.25;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        :global(html[data-theme="light"]) .dealer-demo-shell{--demo-panel:#fff;--demo-card:#eef2f7;--demo-soft:#dde4ed;--demo-avatar:#cfd8e5;--demo-text:#171b23;--demo-muted:#536176;--demo-positive:#20a85e}
        :global(html[data-theme="light"]) .dealer-demo-window{border:1px solid rgba(31,38,51,.08)}
        :global(html[data-theme="light"]) .demo-funnel-card{border-color:rgba(31,38,51,.09);background:#fff;box-shadow:0 8px 20px rgba(44,55,75,.06)}
        :global(html[data-theme="light"]) .demo-funnel--new{background-color:rgba(32,168,94,.10)}:global(html[data-theme="light"]) .demo-funnel--work{background-color:rgba(217,167,0,.10)}:global(html[data-theme="light"]) .demo-funnel--ready{background-color:rgba(22,158,209,.10)}:global(html[data-theme="light"]) .demo-funnel--deal{background-color:rgba(239,51,64,.09)}
        @media(prefers-reduced-motion:reduce){.dealer-demo-fade{animation:none}}
      `}</style>
    </div>
  );
}
