"use client";

import { useEffect, useRef, useState } from "react";
import { AFFILIATE_LINK_REL, AUTOCREDIT_AFFILIATE_URL, OSAGO_AFFILIATE_URL } from "@/lib/affiliate-links";

function FinanceCards() {
  return (
    <section className="ac-offer-finance-cards grid gap-4 xl:grid-cols-2" aria-label="Финансовые сервисы">
      <a href={AUTOCREDIT_AFFILIATE_URL} target="_blank" rel={AFFILIATE_LINK_REL} aria-label="Подобрать автокредит в ВТБ" className="ac-finance-card relative block min-h-[206px] overflow-hidden rounded-[1.6rem] bg-[var(--ac-surface)] px-6 py-6 transition-[filter,transform] hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#35c932] active:scale-[.995]">
        <div className="relative z-10 h-full min-h-[158px] pr-[150px]">
          <div className="flex items-start gap-7">
            <div className="flex h-[46px] w-[46px] shrink-0 items-center justify-center text-[#35c932]" aria-hidden="true">
              <svg width="44" height="44" viewBox="0 0 48 48" fill="none"><rect x="7" y="5" width="34" height="38" rx="4" stroke="currentColor" strokeWidth="3.5"/><path d="M14 13h20M15 23h6M18 20v6M28 20l6 6M34 20l-6 6M15 34h6M28 34h6" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"/></svg>
            </div>
            <h3 className="min-w-0 pt-0.5 text-[23px] font-black leading-[1.08] text-[var(--ac-text)]">Кредитный<br />калькулятор</h3>
          </div>
          <p className="mt-8 max-w-[350px] text-[15px] font-medium leading-[1.45] text-[var(--ac-muted)]">Рассчитайте платёж и подберите удобные условия покупки автомобиля.</p>
        </div>
        <img src="/home/credit-mascot.webp" alt="" className="pointer-events-none absolute bottom-0 right-3 h-[194px] w-[194px] object-contain object-bottom xl:right-4 xl:h-[202px] xl:w-[202px]" aria-hidden="true" />
      </a>

      <a href={OSAGO_AFFILIATE_URL} target="_blank" rel={AFFILIATE_LINK_REL} aria-label="Рассчитать полис ОСАГО на Банки.ру" className="ac-finance-card relative block min-h-[206px] overflow-hidden rounded-[1.6rem] bg-[var(--ac-surface)] px-6 py-6 transition-[filter,transform] hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ffd21f] active:scale-[.995]">
        <div className="relative z-10 h-full min-h-[158px] pr-[150px]">
          <div className="flex items-start gap-7">
            <div className="flex h-[46px] w-[46px] shrink-0 items-center justify-center text-[#ffd21f]" aria-hidden="true">
              <svg width="44" height="44" viewBox="0 0 48 48" fill="none"><path d="M24 5 38 10v10.5c0 9-5.7 16.4-14 20.5-8.3-4.1-14-11.5-14-20.5V10l14-5Z" stroke="currentColor" strokeWidth="3.5" strokeLinejoin="round"/><path d="m17 23 5 5 10-10" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <h3 className="min-w-0 pt-0.5 text-[23px] font-black leading-[1.08] text-[var(--ac-text)]">Страховой полис<br />ОСАГО</h3>
          </div>
          <p className="mt-8 max-w-[350px] text-[15px] font-medium leading-[1.45] text-[var(--ac-muted)]">Быстрый расчёт стоимости полиса для выбранного автомобиля.</p>
        </div>
        <img src="/home/osago-mascot.webp" alt="" className="pointer-events-none absolute bottom-0 right-1 h-[202px] w-[202px] object-contain object-bottom xl:right-2 xl:h-[210px] xl:w-[210px]" aria-hidden="true" />
      </a>
    </section>
  );
}

export function OfferFinanceCards() {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const page = host.current?.closest("main.ac-offer-page");
    if (!page) return;
    const sync = () => setVisible(window.innerWidth >= 1280 && Boolean(page.querySelector<HTMLDetailsElement>(".ac-offer-breakdown")?.open));
    const observer = new MutationObserver(sync);
    observer.observe(page, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    window.addEventListener("resize", sync);
    sync();
    return () => { observer.disconnect(); window.removeEventListener("resize", sync); };
  }, []);

  return (
    <>
      <div ref={host} data-offer-finance-cards-host="true" className="mt-4" hidden={!visible}>{visible ? <FinanceCards /> : null}</div>
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
