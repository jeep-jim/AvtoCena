"use client";
import { FavoriteToggle, type FavoriteSnapshot } from "./FavoriteToggle";
import { ShareLinkButton } from "./ShareLinkButton";
import { AFFILIATE_LINK_REL, AUTOCREDIT_AFFILIATE_URL } from "@/lib/affiliate-links";

function PhoneIcon() {
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7.15 3.75 10 8.35 8.3 10.1a14.9 14.9 0 0 0 5.6 5.6l1.75-1.7 4.6 2.85c.5.3.7.92.48 1.46-.56 1.38-1.83 2.3-3.31 2.4C10.08 21.13 2.87 13.92 3.29 6.58c.1-1.48 1.02-2.75 2.4-3.31.54-.22 1.16-.02 1.46.48Z" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

type FavoriteProps = {offerId: string; snapshot: FavoriteSnapshot};

function ActionButtons({ className = "", stacked = false, offerId, snapshot }: FavoriteProps & { className?: string; stacked?: boolean }) {
  const buttonClass = "ac-offer-contact-button relative inline-flex h-[54px] min-w-0 items-center justify-center rounded-[1.05rem] px-11 text-[13px] font-black leading-none !text-white transition-[filter,transform] hover:brightness-95 active:scale-[.99] sm:px-12 sm:text-sm md:px-12 md:text-base xl:h-14";
  return <div className={`ac-offer-action-row grid ${stacked ? "grid-cols-1 gap-3" : "grid-cols-2 gap-3 md:gap-4"} ${className}`}>
    <button type="button" data-offer-action="lead" className={`${buttonClass} bg-[#22B14C]`}><span className="pointer-events-none absolute left-4 inline-flex items-center justify-center xl:left-5"><PhoneIcon /></span><span className="whitespace-nowrap">Оставить заявку на расчёт</span></button>
    <ShareLinkButton compactMobile className={`${buttonClass} bg-[#00A2E8]`} />
    <div data-offer-pdf-slot className="empty:!hidden" />
    <FavoriteToggle offerId={offerId} snapshot={snapshot} compact className="ac-offer-favorite" />
  </div>;
}

export function OfferDesktopActions({position = "sidebar", ...favorite}: FavoriteProps & {position?: "sidebar" | "below"}) {
  return <ActionButtons {...favorite} stacked={position === "sidebar"} className={`mt-4 hidden xl:grid ac-offer-actions-${position}`} />;
}

export function OfferMobileActions(favorite: FavoriteProps) {
  // Remain in document flow. The former body portal measured the page before
  // layout settled, briefly placing these controls at the viewport origin.
  return <div className="relative z-20 mt-4 w-full xl:hidden"><ActionButtons {...favorite} stacked /></div>;
}

export function OfferCreditCalculator() {
  return <div data-offer-credit-host>
    <section className="ac-credit-calculator-mock rounded-[1.35rem] border border-[var(--ac-border)] bg-[var(--ac-surface-2)] p-4" aria-label="Кредитный калькулятор">
      <div className="flex items-start justify-between gap-4"><div className="min-w-0"><div className="text-[10px] font-black uppercase tracking-[0.16em] text-red-500">Финансирование</div><div className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1"><h2 className="text-xl font-black tracking-[-0.035em] text-[var(--ac-text)]">Кредитный калькулятор</h2><span className="text-xs font-semibold text-[var(--ac-muted)]">Сюда подключим форму партнёра.</span></div></div><span className="shrink-0 rounded-full bg-red-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-red-500">Скоро</span></div>
      <div className="mt-3 grid grid-cols-3 gap-2">{[["Стоимость авто", "из карточки"], ["Первый взнос", "0 ₽"], ["Срок", "60 мес"]].map(([label, value]) => <div key={label} className="rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface)] px-3 py-2.5"><div className="text-[10px] font-bold text-[var(--ac-muted)]">{label}</div><div className="mt-0.5 text-sm font-black text-[var(--ac-text)]">{value}</div></div>)}</div>
      <div className="mt-2 flex items-stretch gap-2"><div className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl bg-red-500/10 px-3 py-2.5"><span className="text-xs font-black text-[var(--ac-text)]">Ежемесячный платёж</span><span className="text-lg font-black text-red-500">— ₽</span></div><a href={AUTOCREDIT_AFFILIATE_URL} target="_blank" rel={AFFILIATE_LINK_REL} className="ac-credit-partner-button inline-flex min-w-[176px] items-center justify-center rounded-xl bg-[#111318] px-4 py-2.5 text-xs font-black !text-white transition-[filter,transform] hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-[.99]">Подобрать кредит</a></div>
    </section>
  </div>;
}

export function OfferContactActionsStyles() {
  return <style dangerouslySetInnerHTML={{ __html: `
    html[data-theme="light"] .ac-offer-page .ac-offer-updated{background:#fff!important;border:1px solid var(--ac-border)!important}
    .ac-offer-contact-button{color:#fff!important}
    .ac-offer-action-row .ac-offer-contact-button>svg{display:block!important}
    .ac-offer-contact-button>span{font-size:inherit}
    .ac-credit-partner-button{color:#fff!important;-webkit-text-fill-color:#fff!important}
    .ac-offer-page [data-offer-credit-host]{display:none!important}
    .ac-offer-page>section>section{border-top:1px solid rgba(255,255,255,.085)!important;padding-top:1rem}
    html[data-theme="light"] .ac-offer-page>section>section{border-top-color:rgba(35,42,55,.12)!important}
    .ac-offer-favorite{width:54px!important;height:54px!important;border-radius:1.05rem!important;background:rgba(255,53,61,.09)!important;color:#ff353d!important}
    .ac-offer-favorite svg{width:26px;height:26px}
    @media(max-width:1279px){
      .ac-offer-action-row{grid-template-columns:minmax(0,1fr) 54px;gap:10px}
      .ac-offer-action-row>[data-offer-action="lead"]{grid-column:1/-1}
      .ac-offer-action-row[data-has-pdf="true"]{grid-template-columns:minmax(0,1fr) 76px 54px}
      .ac-offer-action-row [data-offer-pdf-slot] button{padding:0;gap:4px}
      .ac-offer-action-row [data-offer-pdf-slot] svg{width:18px}
      .ac-offer-action-row .ac-offer-contact-button{padding-left:34px;padding-right:8px}
      .ac-offer-action-row .ac-offer-contact-button>span:first-child{left:10px}
      .ac-offer-action-row .ac-offer-contact-button>svg{left:10px}
    }
    @media(min-width:1280px){
      .ac-offer-favorite{height:56px!important;width:56px!important}
      .ac-offer-actions-below{grid-template-columns:minmax(0,1.25fr) minmax(0,1fr) 56px}
      .ac-offer-actions-sidebar{grid-template-columns:minmax(0,1fr) 56px}
      .ac-offer-actions-sidebar>[data-offer-action="lead"]{grid-column:1/-1}
      .ac-offer-actions-sidebar[data-has-pdf="true"]{grid-template-columns:minmax(0,1fr) 80px 56px}
      .ac-offer-actions-sidebar .ac-offer-contact-button{padding-left:34px;padding-right:8px;font-size:13px}
      .ac-offer-actions-sidebar .ac-offer-contact-button>svg{left:10px}
      .ac-offer-actions-sidebar .ac-offer-contact-button>span>span:first-child{display:inline!important}
      .ac-offer-actions-sidebar .ac-offer-contact-button>span>span:last-child{display:none!important}
      .ac-offer-actions-sidebar [data-offer-pdf-slot] button{padding:0;gap:4px}


      .ac-offer-actions-below[data-has-pdf="true"]{grid-template-columns:minmax(0,1.25fr) minmax(0,1fr) 100px 56px}
      .ac-offer-page .ac-offer-actions-sidebar{display:none}
      .ac-offer-page:has([data-spec-desktop][data-open="true"]) .ac-offer-actions-sidebar{display:grid}
      .ac-offer-page:has([data-spec-desktop][data-open="true"]) .ac-offer-actions-below{display:none}

      .ac-offer-page .ac-offer-detail-stack>div:first-child{grid-template-columns:repeat(6,minmax(0,1fr))!important}
      .ac-offer-page .ac-offer-detail-stack>div:first-child>.ac-offer-spec-tile{grid-column:span 3!important;order:10}
      .ac-offer-page .ac-offer-detail-stack>div:first-child>.ac-offer-spec-tile[aria-label^="Год:"]{grid-column:span 2!important;order:1}
      .ac-offer-page .ac-offer-detail-stack>div:first-child>.ac-offer-spec-tile[aria-label^="Двигатель:"]{grid-column:span 2!important;order:2}
      .ac-offer-page .ac-offer-detail-stack>div:first-child>.ac-offer-spec-tile[aria-label^="Пробег:"]{grid-column:span 2!important;order:3}
      .ac-offer-page .ac-offer-detail-stack>div:first-child:not(:has(.ac-offer-spec-tile[aria-label^="Пробег:"]))>.ac-offer-spec-tile[aria-label^="Год:"],.ac-offer-page .ac-offer-detail-stack>div:first-child:not(:has(.ac-offer-spec-tile[aria-label^="Пробег:"]))>.ac-offer-spec-tile[aria-label^="Двигатель:"]{grid-column:span 3!important}
      .ac-offer-page:has(.ac-offer-breakdown[open]) [data-offer-credit-host]{display:block!important;margin-top:1rem}
      .ac-credit-calculator-mock{border:1px solid rgba(255,255,255,.06);box-shadow:0 12px 28px rgba(0,0,0,.10)!important}
      html[data-theme="light"] .ac-credit-calculator-mock{border-color:rgba(35,42,55,.09);box-shadow:0 12px 26px rgba(38,43,57,.07)!important}
    }
  ` }} />;
}
