"use client";

import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

function FinanceCards() {
  return (
    <section className="ac-offer-finance-cards grid gap-4 xl:grid-cols-2" aria-label="Финансовые сервисы">
      <article className="ac-executor-block relative min-h-[206px] overflow-hidden rounded-[1.6rem] px-6 py-6">
        <div className="relative z-10 h-full min-h-[158px] pr-[205px]">
          <div className="flex items-start gap-7">
            <div className="flex h-[46px] w-[46px] shrink-0 items-center justify-center text-[#35c932]" aria-hidden="true">
              <svg width="44" height="44" viewBox="0 0 48 48" fill="none"><rect x="7" y="5" width="34" height="38" rx="4" stroke="currentColor" strokeWidth="3.5"/><path d="M14 13h20M15 23h6M18 20v6M28 20l6 6M34 20l-6 6M15 34h6M28 34h6" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"/></svg>
            </div>
            <h3 className="min-w-0 pt-0.5 text-[23px] font-black leading-[1.08] text-[var(--ac-text)]">Кредитный<br />калькулятор</h3>
          </div>
          <p className="mt-8 max-w-[350px] text-[15px] font-medium leading-[1.45] text-[var(--ac-muted)]">Рассчитайте платёж и подберите<br className="hidden xl:block" /> удобные условия покупки автомобиля.</p>
        </div>
        <img src="/home/credit-mascot.webp" alt="" className="pointer-events-none absolute bottom-[-2px] right-3 h-[194px] w-[194px] object-contain object-bottom xl:right-4 xl:h-[202px] xl:w-[202px]" aria-hidden="true" />
      </article>

      <article className="ac-executor-block relative min-h-[206px] overflow-hidden rounded-[1.6rem] px-6 py-6">
        <div className="relative z-10 h-full min-h-[158px] pr-[215px]">
          <div className="flex items-start gap-7">
            <div className="flex h-[46px] w-[46px] shrink-0 items-center justify-center text-[#ffd21f]" aria-hidden="true">
              <svg width="44" height="44" viewBox="0 0 48 48" fill="none"><path d="M24 5 38 10v10.5c0 9-5.7 16.4-14 20.5-8.3-4.1-14-11.5-14-20.5V10l14-5Z" stroke="currentColor" strokeWidth="3.5" strokeLinejoin="round"/><path d="m17 23 5 5 10-10" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <h3 className="min-w-0 pt-0.5 text-[23px] font-black leading-[1.08] text-[var(--ac-text)]">Страховой полис<br />ОСАГО</h3>
          </div>
          <p className="mt-8 max-w-[350px] text-[15px] font-medium leading-[1.45] text-[var(--ac-muted)]">Быстрый расчёт стоимости полиса<br className="hidden xl:block" /> для выбранного автомобиля.</p>
        </div>
        <img src="/home/osago-mascot.webp" alt="" className="pointer-events-none absolute bottom-[-3px] right-1 h-[202px] w-[202px] object-contain object-bottom xl:right-2 xl:h-[210px] xl:w-[210px]" aria-hidden="true" />
      </article>
    </section>
  );
}

export function OfferFinanceCards() {
  const pathname = usePathname();
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!pathname?.startsWith("/cars/offer/")) return;

    let cancelled = false;
    let frame = 0;
    let financeHost: HTMLElement | null = null;
    let breakdown: HTMLDetailsElement | null = null;
    let observer: MutationObserver | null = null;

    const sync = () => {
      if (!financeHost || !breakdown) return;
      financeHost.hidden = !(window.innerWidth >= 1280 && breakdown.open);
    };

    const mount = () => {
      if (cancelled) return;
      const page = document.querySelector<HTMLElement>("main.ac-offer-page");
      const section = page?.querySelector<HTMLElement>(":scope > section");
      const grid = section?.querySelector<HTMLElement>(":scope > div.grid");
      const mediaColumn = grid?.children?.[0] as HTMLElement | undefined;
      breakdown = page?.querySelector<HTMLDetailsElement>(".ac-offer-breakdown") || null;

      if (!page || !grid || !mediaColumn || !breakdown) {
        frame = window.requestAnimationFrame(mount);
        return;
      }

      page.querySelectorAll<HTMLElement>("[data-offer-finance-cards-host]").forEach((node) => node.remove());
      financeHost = document.createElement("div");
      financeHost.dataset.offerFinanceCardsHost = "true";
      financeHost.className = "mt-4";
      mediaColumn.appendChild(financeHost);
      setHost(financeHost);

      observer = new MutationObserver(sync);
      observer.observe(breakdown, { attributes: true, attributeFilter: ["open"] });
      window.addEventListener("resize", sync);
      sync();
    };

    mount();
    return () => {
      cancelled = true;
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", sync);
      financeHost?.remove();
      setHost(null);
    };
  }, [pathname]);

  return (
    <>
      {host ? createPortal(<FinanceCards />, host) : null}
      <style jsx global>{`
        .ac-offer-page .ac-credit-calculator-mock,
        html body .ac-offer-page [data-offer-credit-mobile-host] {
          display: none !important;
        }
        @media (max-width: 1279px) {
          .ac-offer-page > section > div.grid > :first-child {
            order: 0 !important;
          }
          .ac-offer-page > section > div.grid > :nth-child(2) {
            order: 1 !important;
          }
          .ac-offer-page [data-offer-finance-cards-host] {
            display: none !important;
          }
        }
      `}</style>
    </>
  );
}
