"use client";

import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AFFILIATE_LINK_REL, AUTOCREDIT_AFFILIATE_URL } from "@/lib/affiliate-links";

type Hosts = {
  desktop: HTMLElement | null;
  mobile: HTMLElement | null;
  credit: HTMLElement | null;
};

function ChatIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5.5 5.25h13A2.25 2.25 0 0 1 20.75 7.5v8A2.25 2.25 0 0 1 18.5 17.75h-7.25L6 21v-3.25h-.5a2.25 2.25 0 0 1-2.25-2.25v-8A2.25 2.25 0 0 1 5.5 5.25Z" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="8" cy="11.5" r=".85" fill="currentColor" />
      <circle cx="12" cy="11.5" r=".85" fill="currentColor" />
      <circle cx="16" cy="11.5" r=".85" fill="currentColor" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7.15 3.75 10 8.35 8.3 10.1a14.9 14.9 0 0 0 5.6 5.6l1.75-1.7 4.6 2.85c.5.3.7.92.48 1.46-.56 1.38-1.83 2.3-3.31 2.4C10.08 21.13 2.87 13.92 3.29 6.58c.1-1.48 1.02-2.75 2.4-3.31.54-.22 1.16-.02 1.46.48Z" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CreditCalculatorMockup() {
  return (
    <section className="ac-credit-calculator-mock rounded-[1.35rem] border border-[var(--ac-border)] bg-[var(--ac-surface-2)] p-4" aria-label="Кредитный калькулятор">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-[0.16em] text-red-500">Финансирование</div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-xl font-black tracking-[-0.035em] text-[var(--ac-text)]">Кредитный калькулятор</h2>
            <span className="text-xs font-semibold text-[var(--ac-muted)]">Сюда подключим форму партнёра.</span>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-red-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-red-500">Скоро</span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface)] px-3 py-2.5">
          <div className="text-[10px] font-bold text-[var(--ac-muted)]">Стоимость авто</div>
          <div className="mt-0.5 text-sm font-black text-[var(--ac-text)]">из карточки</div>
        </div>
        <div className="rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface)] px-3 py-2.5">
          <div className="text-[10px] font-bold text-[var(--ac-muted)]">Первый взнос</div>
          <div className="mt-0.5 text-sm font-black text-[var(--ac-text)]">0 ₽</div>
        </div>
        <div className="rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface)] px-3 py-2.5">
          <div className="text-[10px] font-bold text-[var(--ac-muted)]">Срок</div>
          <div className="mt-0.5 text-sm font-black text-[var(--ac-text)]">60 мес</div>
        </div>
      </div>

      <div className="mt-2 flex items-stretch gap-2">
        <div className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl bg-red-500/10 px-3 py-2.5">
          <span className="text-xs font-black text-[var(--ac-text)]">Ежемесячный платёж</span>
          <span className="text-lg font-black text-red-500">— ₽</span>
        </div>
        <a href={AUTOCREDIT_AFFILIATE_URL} target="_blank" rel={AFFILIATE_LINK_REL} className="ac-credit-partner-button inline-flex min-w-[176px] items-center justify-center rounded-xl bg-[#111318] px-4 py-2.5 text-xs font-black !text-white transition-[filter,transform] hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-[.99]">Подобрать кредит</a>
      </div>
    </section>
  );
}

function ActionButtons({ className = "", stacked = false }: { className?: string; stacked?: boolean }) {
  const buttonClass = "ac-offer-contact-button relative inline-flex h-[54px] min-w-0 items-center justify-center rounded-[1.05rem] px-2 text-[12px] font-black leading-none !text-white transition-[filter,transform] hover:brightness-95 active:scale-[.99] sm:px-3 sm:text-sm md:px-12 md:text-base xl:h-14";
  return (
    <div className={`grid ${stacked ? "grid-cols-1 gap-3" : "grid-cols-2 gap-3 md:gap-4"} ${className}`}>
      <button
        type="button"
        data-offer-action="messenger"
        className={`${buttonClass} bg-[#00A2E8]`}
      >
        <span className="pointer-events-none absolute left-4 hidden items-center justify-center md:inline-flex xl:left-5"><ChatIcon /></span>
        <span className="whitespace-nowrap">Чат в мессенджере</span>
      </button>
      <button
        type="button"
        data-offer-action="lead"
        className={`${buttonClass} bg-[#22B14C]`}
      >
        <span className="pointer-events-none absolute left-4 hidden items-center justify-center md:inline-flex xl:left-5"><PhoneIcon /></span>
        <span className="whitespace-nowrap">Оставить заявку</span>
      </button>
    </div>
  );
}

function MobilePinnedActions() {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [fixedStyle, setFixedStyle] = useState<CSSProperties | null>(null);

  useEffect(() => {
    let frame = 0;

    const update = () => {
      frame = 0;
      const anchor = anchorRef.current;
      if (!anchor || window.innerWidth >= 1280) {
        setFixedStyle(null);
        return;
      }

      const rect = anchor.getBoundingClientRect();
      const header = document.querySelector<HTMLElement>(".ac-public-header");
      const headerBottom = header ? Math.max(0, header.getBoundingClientRect().bottom) : 64;
      const fixedTop = headerBottom + 8;
      const shouldFix = rect.top <= fixedTop;

      setFixedStyle(shouldFix ? {
        position: "fixed",
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        top: `${fixedTop}px`,
        zIndex: 9000,
      } : null);
    };

    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);

    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  const actions = (
    <div
      style={fixedStyle || undefined}
      className={`ac-offer-pinned-actions w-full ${fixedStyle ? "is-fixed" : ""}`}
    >
      <ActionButtons />
    </div>
  );

  return (
    <div ref={anchorRef} className="relative mt-4 h-[54px] xl:hidden">
      {fixedStyle && typeof document !== "undefined" ? createPortal(actions, document.body) : actions}
    </div>
  );
}

export function OfferContactActions() {
  const pathname = usePathname();
  const [hosts, setHosts] = useState<Hosts>({ desktop: null, mobile: null, credit: null });

  useEffect(() => {
    document.querySelectorAll<HTMLElement>("[data-offer-actions-host], [data-offer-credit-host], [data-offer-credit-mobile-host]").forEach((node) => node.remove());
    setHosts({ desktop: null, mobile: null, credit: null });

    if (!pathname?.startsWith("/cars/offer/")) return;

    let cancelled = false;
    let frame = 0;
    let desktopHost: HTMLElement | null = null;
    let mobileHost: HTMLElement | null = null;
    let creditHost: HTMLElement | null = null;
    let mobileCreditHost: HTMLElement | null = null;

    const mount = () => {
      if (cancelled) return;
      const page = document.querySelector<HTMLElement>("main.ac-offer-page");
      const section = page?.querySelector<HTMLElement>(":scope > section");
      const grid = section?.querySelector<HTMLElement>(":scope > div.grid");
      const mediaColumn = grid?.children?.[0] as HTMLElement | undefined;
      const desktopSlot = page?.querySelector<HTMLElement>("[data-offer-desktop-actions-slot]");
      const breakdown = page?.querySelector<HTMLElement>(".ac-offer-breakdown");

      if (!page || !section || !grid || !mediaColumn) {
        frame = window.requestAnimationFrame(mount);
        return;
      }

      desktopHost = document.createElement("div");
      desktopHost.dataset.offerActionsHost = "desktop";
      (desktopSlot || mediaColumn).appendChild(desktopHost);

      mobileHost = document.createElement("div");
      mobileHost.dataset.offerActionsHost = "mobile";
      grid.insertAdjacentElement("afterend", mobileHost);

      creditHost = document.createElement("div");
      creditHost.dataset.offerCreditHost = "true";
      mediaColumn.appendChild(creditHost);

      if (breakdown) {
        mobileCreditHost = document.createElement("div");
        mobileCreditHost.dataset.offerCreditMobileHost = "true";
        const mobileCreditButton = document.createElement("a");
        mobileCreditButton.href = AUTOCREDIT_AFFILIATE_URL;
        mobileCreditButton.target = "_blank";
        mobileCreditButton.rel = AFFILIATE_LINK_REL;
        mobileCreditButton.className = "ac-mobile-credit-button";
        mobileCreditButton.textContent = "Кредитный калькулятор";
        mobileCreditHost.appendChild(mobileCreditButton);
        breakdown.appendChild(mobileCreditHost);
      }

      if (!cancelled) setHosts({ desktop: desktopHost, mobile: mobileHost, credit: creditHost });
    };

    mount();

    return () => {
      cancelled = true;
      if (frame) window.cancelAnimationFrame(frame);
      desktopHost?.remove();
      mobileHost?.remove();
      creditHost?.remove();
      mobileCreditHost?.remove();
    };
  }, [pathname]);

  return (
    <>
      {hosts.desktop ? createPortal(<ActionButtons stacked className="mt-4 hidden xl:grid" />, hosts.desktop) : null}
      {hosts.mobile ? createPortal(<MobilePinnedActions />, hosts.mobile) : null}
      {hosts.credit ? createPortal(<CreditCalculatorMockup />, hosts.credit) : null}
      <style jsx global>{`
        .ac-offer-contact-button {
          color: #fff !important;
        }
        .ac-credit-partner-button {
          color: #fff !important;
          -webkit-text-fill-color: #fff !important;
        }
        .ac-offer-pinned-actions {
          position: relative;
          isolation: isolate;
        }
        .ac-offer-pinned-actions.is-fixed {
          z-index: 9000 !important;
        }
        .ac-offer-pinned-actions.is-fixed::before {
          content: "";
          position: absolute;
          inset: -7px -6px;
          z-index: -1;
          pointer-events: none;
          border: 1px solid rgba(255,255,255,.08);
          border-radius: 1.35rem;
          background: rgba(26,32,41,.72);
          -webkit-backdrop-filter: blur(16px) saturate(125%);
          backdrop-filter: blur(16px) saturate(125%);
          box-shadow: 0 10px 30px rgba(0,0,0,.16);
        }
        html[data-theme="light"] .ac-offer-pinned-actions.is-fixed::before {
          border-color: rgba(35,42,55,.10);
          background: rgba(246,248,251,.78);
          box-shadow: 0 10px 28px rgba(38,43,57,.10);
        }
        @media (min-width: 1280px) {
          .ac-offer-page .ac-offer-detail-stack > div:first-child {
            grid-template-columns: repeat(6, minmax(0, 1fr)) !important;
          }
          .ac-offer-page .ac-offer-detail-stack > div:first-child > .ac-offer-spec-tile {
            grid-column: span 3 !important;
            order: 10;
          }
          .ac-offer-page .ac-offer-detail-stack > div:first-child > .ac-offer-spec-tile[aria-label^="Год:"] {
            grid-column: span 2 !important;
            order: 1;
          }
          .ac-offer-page .ac-offer-detail-stack > div:first-child > .ac-offer-spec-tile[aria-label^="Двигатель:"] {
            grid-column: span 2 !important;
            order: 2;
          }
          .ac-offer-page .ac-offer-detail-stack > div:first-child > .ac-offer-spec-tile[aria-label^="Пробег:"] {
            grid-column: span 2 !important;
            order: 3;
          }
          .ac-offer-page .ac-offer-detail-stack > div:first-child:not(:has(.ac-offer-spec-tile[aria-label^="Пробег:"])) > .ac-offer-spec-tile[aria-label^="Год:"],
          .ac-offer-page .ac-offer-detail-stack > div:first-child:not(:has(.ac-offer-spec-tile[aria-label^="Пробег:"])) > .ac-offer-spec-tile[aria-label^="Двигатель:"] {
            grid-column: span 3 !important;
          }
          .ac-offer-page [data-offer-credit-host] {
            display: none;
            margin-top: 1.25rem;
          }
          .ac-offer-page:has(.ac-offer-breakdown[open]) [data-offer-credit-host] {
            display: block;
          }
          .ac-credit-calculator-mock {
            border: 1px solid rgba(255,255,255,.06);
            box-shadow: 0 18px 44px rgba(0,0,0,.13);
          }
          .ac-credit-calculator-mock .ac-credit-field {
            background: rgba(255,255,255,.045) !important;
          }
          html[data-theme="light"] .ac-credit-calculator-mock {
            border-color: rgba(35,42,55,.09);
            box-shadow: 0 18px 44px rgba(38,43,57,.08);
          }
          html[data-theme="light"] .ac-credit-calculator-mock .ac-credit-field {
            background: rgba(35,42,55,.045) !important;
          }
        }
        .ac-offer-page [data-offer-credit-host],
        .ac-offer-page [data-offer-credit-mobile-host] {
          display: none !important;
        }
        @media (max-width: 1279px) {
          .ac-offer-page [data-offer-credit-mobile-host] {
            display: block !important;
            padding: 0 1rem 1rem;
          }
          .ac-mobile-credit-button {
            display: flex;
            width: 100%;
            height: 46px;
            align-items: center;
            justify-content: center;
            border: 0;
            border-radius: .9rem;
            background: #0b0d11;
            color: #fff !important;
            font-size: 13px;
            font-weight: 900;
            line-height: 1;
            box-shadow: 0 8px 18px rgba(0,0,0,.12);
          }
          html[data-theme="light"] .ac-mobile-credit-button {
            border-color: #0b0d11;
            background: #0b0d11;
            color: #fff !important;
          }
        }
        @media (min-width: 1280px) {
          .ac-offer-page:has(.ac-offer-breakdown[open]) [data-offer-credit-host] {
            display: block !important;
            margin-top: 1rem;
          }
          .ac-credit-calculator-mock {
            box-shadow: 0 12px 28px rgba(0,0,0,.10) !important;
          }
          html[data-theme="light"] .ac-credit-calculator-mock {
            box-shadow: 0 12px 26px rgba(38,43,57,.07) !important;
          }
        }
        .ac-offer-page > section > section {
          border-top: 1px solid rgba(255,255,255,.085) !important;
          padding-top: 1rem;
        }
        html[data-theme="light"] .ac-offer-page > section > section {
          border-top-color: rgba(35,42,55,.12) !important;
        }
      `}</style>
    </>
  );
}
