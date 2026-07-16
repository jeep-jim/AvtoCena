"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const COOKIE_NOTICE_STORAGE_KEY = "avtocena_cookie_notice_acknowledged_v1";
const INTERNAL_ROUTE_PREFIXES = ["/crm", "/login", "/api"];

const marketLinks = [
  { href: "/cars?market=japan", label: "Автомобили из Японии" },
  { href: "/cars?market=china", label: "Автомобили из Китая" },
  { href: "/cars?market=korea", label: "Автомобили из Кореи" },
  { href: "/cars?market=uae", label: "Автомобили из ОАЭ" },
  { href: "/cars?market=europe", label: "Автомобили из Европы" },
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
        {links.map((link) => (
          <Link key={link.href} href={link.href} className="ac-public-footer-nav-link w-fit">
            {link.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

export function PublicLegalFooter() {
  const pathname = usePathname();
  const publicPath = isPublicPath(pathname || "/");
  const [cookieOpen, setCookieOpen] = useState(false);
  const currentYear = new Date().getFullYear();

  const closeCookieNotice = useCallback(() => {
    setCookieOpen(false);
    try {
      window.localStorage.setItem(COOKIE_NOTICE_STORAGE_KEY, "1");
    } catch {
      // Closing the notice must still work without localStorage.
    }
  }, []);

  useEffect(() => {
    if (!publicPath) return;

    try {
      if (!window.localStorage.getItem(COOKIE_NOTICE_STORAGE_KEY)) {
        const frame = window.requestAnimationFrame(() => setCookieOpen(true));
        return () => window.cancelAnimationFrame(frame);
      }
    } catch {
      // The footer remains usable when storage is unavailable.
    }
  }, [publicPath]);

  useEffect(() => {
    if (!cookieOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeCookieNotice();
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [cookieOpen, closeCookieNotice]);

  if (!publicPath) return null;

  return (
    <>
      <footer className="ac-public-legal-footer mx-auto mt-14 w-full max-w-[1500px] px-4 pb-8 md:mt-20 md:px-8 md:pb-10">
        <div className="ac-public-footer-navigation grid gap-8 py-7 sm:grid-cols-2 lg:grid-cols-[minmax(260px,1.25fr)_1fr_1fr_1fr] lg:gap-10 lg:py-9">
          <div className="max-w-md">
            <Link href="/" className="inline-flex items-baseline text-xl font-black tracking-[-0.03em]">
              <span className="text-red-500">Авто</span><span className="text-[var(--ac-text)]">Цена</span>
            </Link>
            <p className="mt-3 text-sm font-medium leading-6">
              Подбор и расчёт автомобилей под ключ из Японии, Китая, Кореи, ОАЭ и Европы.
            </p>
            <Link href="/#form" className="ac-public-footer-cta mt-4 inline-flex min-h-10 items-center rounded-xl px-4 text-sm font-black">
              Рассчитать АвтоЦену
            </Link>
          </div>

          <FooterLinkGroup title="По странам" links={marketLinks} />
          <FooterLinkGroup title="По бюджету" links={budgetLinks} />
          <FooterLinkGroup
            title="Разделы"
            links={[
              { href: "/cars", label: "Каталог автомобилей" },
              { href: "/favorites", label: "Избранные автомобили" },
              { href: "/partner/landing", label: "Партнёрская программа" },
              { href: "/#form", label: "Подбор автомобиля" },
            ]}
          />
        </div>

        <div className="ac-public-legal-footer-line grid gap-3 pt-5 text-xs font-semibold leading-5 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-center lg:gap-6">
          <p className="lg:whitespace-nowrap">
            Данный сайт носит исключительно информационный характер и ни при каких обстоятельствах не является публичной офертой.
          </p>
          <span className="whitespace-nowrap">© {currentYear} АвтоЦена</span>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 lg:justify-end" aria-label="Правовая информация">
            <button type="button" onClick={() => setCookieOpen(true)} className="ac-public-legal-link">
              Cookie
            </button>
            <Link href="/cars" className="ac-public-legal-link">Каталог</Link>
            <Link href="/partner/landing" className="ac-public-legal-link">Партнёрам</Link>
          </nav>
        </div>
      </footer>

      {cookieOpen ? (
        <div
          className="fixed inset-0 z-[10100] flex items-center justify-center bg-black/[0.72] p-3 backdrop-blur-sm sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="avtocena-cookie-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeCookieNotice();
          }}
        >
          <section className="max-h-[90vh] w-full max-w-[780px] overflow-y-auto rounded-[1.35rem] bg-[#18191f] text-[#e8e9ed] shadow-[0_30px_100px_rgba(0,0,0,.52)]">
            <header className="sticky top-0 z-10 flex items-start justify-between gap-5 border-b border-white/10 bg-[#18191f]/[0.96] px-5 py-5 backdrop-blur sm:px-7">
              <h2 id="avtocena-cookie-title" className="text-xl font-bold leading-tight text-white sm:text-2xl">
                Условия использования файлов cookie
              </h2>
              <button
                type="button"
                onClick={closeCookieNotice}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/55 transition hover:bg-white/[0.08] hover:text-white"
                aria-label="Закрыть уведомление"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                  <path d="M3 3L15 15M15 3L3 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </header>

            <div className="space-y-5 px-5 py-6 text-sm leading-6 text-white/[0.78] sm:px-7 sm:py-7 sm:text-[15px] sm:leading-7">
              <p>
                На сайте https://avtocena.com и его поддоменах (далее — Сайт) используются файлы cookie. Файлы cookie — это небольшие текстовые файлы, которые после посещения Сайта сохраняются на устройстве пользователя.
              </p>

              <p>
                Использование файлов cookie помогает сервису «АвтоЦена» обеспечивать корректную работу страниц, запоминать настройки пользователя, сохранять параметры подбора автомобилей, анализировать обезличенные данные и улучшать качество сервиса.
              </p>

              <div>
                <p className="mb-3">На Сайте могут использоваться следующие типы файлов cookie:</p>
                <ol className="space-y-3 pl-5 marker:font-bold marker:text-white">
                  <li>
                    <strong className="text-white">Технические файлы cookie</strong> — необходимы для корректной работы Сайта, форм, навигации, выбора темы, избранного и других основных функций.
                  </li>
                  <li>
                    <strong className="text-white">Файлы cookie для настроек и истории поиска</strong> — позволяют сохранять выбранные фильтры, параметры расчёта и другие действия, чтобы при следующем посещении не вводить их заново.
                  </li>
                  <li>
                    <strong className="text-white">Аналитические файлы cookie</strong> — помогают оценивать посещаемость и действия пользователей на Сайте в обезличенном виде, находить ошибки и улучшать интерфейс.
                  </li>
                  <li>
                    <strong className="text-white">Маркетинговые файлы cookie</strong> — могут использоваться только при подключении рекламных и аналитических сервисов для оценки эффективности рекламных каналов и показа более релевантных предложений.
                  </li>
                </ol>
              </div>

              <p>
                Срок хранения файлов cookie зависит от их назначения и настроек используемого сервиса. Пользователь может удалить сохранённые файлы cookie или ограничить их использование в настройках браузера на компьютере или мобильном устройстве.
              </p>

              <p>
                При ограничении или отключении файлов cookie отдельные функции Сайта могут работать некорректно: например, могут не сохраняться выбранная тема, избранные автомобили или параметры поиска.
              </p>

              <p className="font-bold text-white">
                Закрывая данное уведомление и продолжая пользоваться Сайтом, пользователь подтверждает, что ознакомился с условиями использования файлов cookie.
              </p>

              <div className="pt-1">
                <button type="button" onClick={closeCookieNotice} className="avto-button min-h-12 rounded-2xl px-7 py-3 font-black text-white">
                  Понятно
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
