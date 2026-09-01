"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AFFILIATE_LINK_REL, AUTOCREDIT_AFFILIATE_URL, OSAGO_AFFILIATE_URL } from "@/lib/affiliate-links";

const COOKIE_NOTICE_STORAGE_KEY = "avtocena_cookie_notice_acknowledged_v1";
const INTERNAL_ROUTE_PREFIXES = ["/crm", "/login", "/api"];

const marketLinks = [
  { href: "/cars?market=japan", label: "Автомобили из Японии" },
  { href: "/cars?market=china", label: "Автомобили из Китая" },
  { href: "/cars?market=korea", label: "Автомобили из Кореи" },
  { href: "/cars?market=uae", label: "Автомобили из ОАЭ" },
  { href: "/cars?market=europe", label: "Автомобили из Европы" },
  { href: "/cars?market=georgia", label: "Автомобили из Грузии" },
];

const budgetLinks = [
  { href: "/results?budget=1500000", label: "Авто до 1,5 млн ₽" },
  { href: "/results?budget=2000000", label: "Авто до 2 млн ₽" },
  { href: "/results?budget=3000000", label: "Авто до 3 млн ₽" },
  { href: "/results?budget=5000000", label: "Авто до 5 млн ₽" },
];

function isPublicPath(pathname: string) {
  return !INTERNAL_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function FooterLinkGroup({ title, links }: { title: string; links: Array<{ href: string; label: string }> }) {
  return (
    <nav aria-label={title}>
      <h2 className="text-xs font-black uppercase tracking-[0.15em] text-[var(--ac-text)]">{title}</h2>
      <div className="mt-3 grid gap-2 text-sm font-semibold">
        {links.map((link) => <Link key={link.href} href={link.href} className="ac-public-footer-nav-link w-fit">{link.label}</Link>)}
      </div>
    </nav>
  );
}

function CreditIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.25" y="5.25" width="17.5" height="13.5" rx="2.75" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.8 9.4H20.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M7 14H11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function InsuranceIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3.2 19 6v5.2c0 4.4-2.7 7.6-7 9.6-4.3-2-7-5.2-7-9.6V6l7-2.8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="m8.8 12.1 2.1 2.1 4.5-4.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PublicLegalFooter() {
  const pathname = usePathname();
  const publicPath = isPublicPath(pathname || "/");
  const [cookieOpen, setCookieOpen] = useState(false);
  const currentYear = new Date().getFullYear();

  const closeCookieNotice = useCallback(() => {
    setCookieOpen(false);
    try { window.localStorage.setItem(COOKIE_NOTICE_STORAGE_KEY, "1"); } catch { /* storage can be unavailable */ }
  }, []);

  useEffect(() => {
    if (!publicPath) return;
    try {
      if (!window.localStorage.getItem(COOKIE_NOTICE_STORAGE_KEY)) {
        const frame = window.requestAnimationFrame(() => setCookieOpen(true));
        return () => window.cancelAnimationFrame(frame);
      }
    } catch { /* footer remains usable */ }
  }, [publicPath]);

  useEffect(() => {
    if (!cookieOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") closeCookieNotice(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [cookieOpen, closeCookieNotice]);

  if (!publicPath) return null;

  return (
    <>
      <footer className="ac-public-legal-footer mx-auto mt-14 w-full max-w-[1500px] px-4 pb-8 md:mt-20 md:px-8 md:pb-10">
        <div className="ac-public-footer-navigation grid gap-8 py-7 sm:grid-cols-2 lg:grid-cols-[minmax(290px,1.25fr)_1fr_1fr_1fr] lg:gap-10 lg:py-9">
          <div className="max-w-md">
            <Link href="/" className="inline-flex items-baseline text-xl font-black tracking-[-0.03em]"><span className="text-red-500">Авто</span><span className="text-[var(--ac-text)]">Цена</span></Link>
            <p className="mt-3 text-sm font-medium leading-6">Подбор и расчёт автомобилей под ключ из Японии, Китая, Кореи, ОАЭ, Европы и Грузии.</p>

            <div className="mt-4 grid gap-2">
              <a
                href={AUTOCREDIT_AFFILIATE_URL}
                target="_blank"
                rel={AFFILIATE_LINK_REL}
                className="ac-public-footer-credit relative flex h-12 w-full items-center justify-center rounded-xl bg-[#0d1117] px-10 text-center text-[12px] font-black leading-tight text-white transition-[filter,transform] hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-[.99] sm:px-12 sm:text-sm"
                style={{ backgroundColor: "#0d1117", color: "#ffffff", WebkitTextFillColor: "#ffffff" }}
              >
                <span className="absolute left-4 text-white"><CreditIcon /></span>
                <span className="text-center">Кредитный калькулятор</span>
              </a>

              <a
                href={OSAGO_AFFILIATE_URL}
                target="_blank"
                rel={AFFILIATE_LINK_REL}
                className="ac-public-footer-osago relative flex h-12 w-full items-center justify-center rounded-xl bg-[#FFD400] px-10 text-center text-[12px] font-black leading-tight text-[#111111] transition-[filter,transform] hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FFD400] active:scale-[.99] sm:px-12 sm:text-sm"
                style={{ backgroundColor: "#FFD400", color: "#111111", WebkitTextFillColor: "#111111" }}
              >
                <span className="absolute left-4 text-[#111111]"><InsuranceIcon /></span>
                <span className="text-center">Рассчитать полис ОСАГО</span>
              </a>
            </div>
          </div>

          <FooterLinkGroup title="По странам" links={marketLinks} />
          <FooterLinkGroup title="По бюджету" links={budgetLinks} />
          <FooterLinkGroup title="Разделы" links={[
            { href: "/", label: "Главная" },
            { href: "/cars", label: "Каталог автомобилей" },
            { href: "/favorites", label: "Избранные автомобили" },
            { href: "/dealers", label: "🚗 АвтоДилерам" },
            { href: "/login", label: "Вход для сотрудников" },
          ]} />
        </div>

        <div className="ac-public-legal-footer-line grid gap-3 pt-5 text-xs font-semibold leading-5 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-center lg:gap-6">
          <p className="lg:whitespace-nowrap">Данный сайт носит исключительно информационный характер и ни при каких обстоятельствах не является публичной офертой.</p>
          <span className="whitespace-nowrap">© {currentYear} АвтоЦена</span>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 lg:justify-end" aria-label="Правовая информация">
            <button type="button" onClick={() => setCookieOpen(true)} className="ac-public-legal-link">Cookie</button>
            <Link href="/cars" className="ac-public-legal-link">Каталог</Link>
            <Link href="/dealers" className="ac-public-legal-link">🚗 АвтоДилерам</Link>
            <Link href="/login" className="ac-public-legal-link">Вход</Link>
          </nav>
        </div>
      </footer>

      {cookieOpen ? (
        <div className="fixed inset-0 z-[10100] flex items-center justify-center bg-black/[0.72] p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-labelledby="avtocena-cookie-title" onMouseDown={(event) => { if (event.target === event.currentTarget) closeCookieNotice(); }}>
          <section className="max-h-[90vh] w-full max-w-[780px] overflow-y-auto rounded-[1.35rem] bg-[#18191f] text-[#e8e9ed] shadow-[0_30px_100px_rgba(0,0,0,.52)]">
            <header className="sticky top-0 z-10 flex items-start justify-between gap-5 border-b border-white/10 bg-[#18191f]/[0.96] px-5 py-5 backdrop-blur sm:px-7">
              <h2 id="avtocena-cookie-title" className="text-xl font-bold leading-tight text-white sm:text-2xl">Условия использования файлов cookie</h2>
              <button type="button" onClick={closeCookieNotice} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/55 transition hover:bg-white/[0.08] hover:text-white" aria-label="Закрыть уведомление">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M3 3L15 15M15 3L3 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              </button>
            </header>
            <div className="space-y-5 px-5 py-6 text-sm leading-6 text-white/[0.78] sm:px-7 sm:py-7 sm:text-[15px] sm:leading-7">
              <p>На сайте https://avtocena.com и его поддоменах используются файлы cookie — небольшие текстовые файлы, которые после посещения сохраняются на устройстве пользователя.</p>
              <p>Они помогают обеспечивать корректную работу страниц, запоминать настройки пользователя, сохранять параметры подбора автомобилей, анализировать обезличенные данные и улучшать качество сервиса.</p>
              <div>
                <p className="mb-3">На сайте могут использоваться следующие типы файлов cookie:</p>
                <ol className="space-y-3 pl-5 marker:font-bold marker:text-white">
                  <li><strong className="text-white">Технические</strong> — необходимы для форм, навигации, выбора темы, избранного и других основных функций.</li>
                  <li><strong className="text-white">Настройки и история поиска</strong> — сохраняют выбранные фильтры и параметры расчёта.</li>
                  <li><strong className="text-white">Аналитические</strong> — помогают находить ошибки и улучшать интерфейс в обезличенном виде.</li>
                  <li><strong className="text-white">Маркетинговые</strong> — применяются только при подключении рекламных и аналитических сервисов.</li>
                </ol>
              </div>
              <p>Пользователь может удалить cookie или ограничить их использование в настройках браузера. При отключении отдельные функции могут работать некорректно.</p>
              <p className="font-bold text-white">Закрывая уведомление и продолжая пользоваться сайтом, пользователь подтверждает, что ознакомился с условиями использования cookie.</p>
              <button type="button" onClick={closeCookieNotice} className="avto-button min-h-12 rounded-2xl px-7 py-3 font-black text-white">Понятно</button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
