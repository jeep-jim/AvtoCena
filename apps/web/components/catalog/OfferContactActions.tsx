"use client";
import {useEffect,useRef,type ReactNode} from "react";
import { FavoriteToggle, type FavoriteSnapshot } from "./FavoriteToggle";
import { ShareLinkButton } from "./ShareLinkButton";
import { AFFILIATE_LINK_REL, AUTOCREDIT_AFFILIATE_URL } from "@/lib/affiliate-links";

function PhoneIcon() {
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7.15 3.75 10 8.35 8.3 10.1a14.9 14.9 0 0 0 5.6 5.6l1.75-1.7 4.6 2.85c.5.3.7.92.48 1.46-.56 1.38-1.83 2.3-3.31 2.4C10.08 21.13 2.87 13.92 3.29 6.58c.1-1.48 1.02-2.75 2.4-3.31.54-.22 1.16-.02 1.46.48Z" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

type FavoriteProps = {offerId: string; snapshot: FavoriteSnapshot};

function ActionButtons({ className = "", stacked = false, stickyContact=false, offerId, snapshot }: FavoriteProps & { className?: string; stacked?: boolean;stickyContact?:boolean }) {
  const buttonClass = "ac-offer-contact-button relative inline-flex h-14 min-w-0 items-center justify-center rounded-[1.05rem] px-12 text-base font-black leading-tight !text-white transition-[filter,transform] hover:brightness-95 active:scale-[.99] ";
  const contact=<button type="button" data-offer-action="lead" className={`${buttonClass} bg-[#22B14C]`}><span className="pointer-events-none absolute left-4 inline-flex items-center justify-center xl:left-5"><PhoneIcon /></span><span>{stickyContact?'Связаться':'Оставить заявку на расчёт'}</span></button>;
  return <div className={`ac-offer-action-row grid ${stacked ? "grid-cols-1 gap-3" : "grid-cols-2 gap-3 md:gap-4"} ${className}`}>
    {stickyContact?<StickyContact>{contact}</StickyContact>:contact}
    <ShareLinkButton compactMobile className={`${buttonClass} bg-[#00A2E8]`} />
    <div data-offer-copy-slot className="empty:!hidden" />
    <div data-offer-pdf-slot className="empty:!hidden" />
    <FavoriteToggle offerId={offerId} snapshot={snapshot} compact className="ac-offer-favorite" />
  </div>;
}

export function OfferDesktopActions({position = "sidebar", ...favorite}: FavoriteProps & {position?: "sidebar" | "below"}) {
  return <ActionButtons {...favorite} stacked={position === "sidebar"} className={`mt-4 hidden xl:grid ac-offer-actions-${position}`} />;
}

function StickyContact({children}:{children:ReactNode}) {
  const anchor=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const node=anchor.current,button=node?.querySelector<HTMLElement>('button');if(!node||!button)return;
    const header=document.querySelector<HTMLElement>('.ac-public-header');
    let frame=0;
    const update=()=>{
      frame=0;
      const rect=node.getBoundingClientRect();
      const top=Math.max(0,header?.getBoundingClientRect().bottom||0)+8;
      const fixed=window.innerWidth<1280&&rect.width>0&&rect.top<top;
      node.dataset.stuck=String(fixed);
      button.style.position=fixed?'fixed':'';
      button.style.top=fixed?`${top}px`:'';
      button.style.left=fixed?`${rect.left}px`:'';
      button.style.width=fixed?`${rect.width}px`:'100%';
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
    const observer=new ResizeObserver(schedule);observer.observe(node);observer.observe(document.body);if(header)observer.observe(header);
    window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule);update();
    return()=>{cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);};
  },[]);
  return <div ref={anchor} className="ac-offer-contact-anchor" data-stuck="false">{children}</div>;
}

export function OfferMobileActions(favorite: FavoriteProps) {
  return <div className="relative z-20 mt-4 w-full xl:hidden"><ActionButtons {...favorite} stacked stickyContact/></div>;
}

export function OfferCreditCalculator() {
  return <div data-offer-credit-host>
    <section className="ac-credit-calculator-mock rounded-[1.35rem] border border-[var(--ac-border)] bg-[var(--ac-surface-2)] p-4" aria-label="Кредитный калькулятор">
      <div className="flex items-start justify-between gap-4"><div className="min-w-0"><div className="text-[10px] font-black normal-case tracking-normal text-red-500">Финансирование</div><div className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1"><h2 className="text-xl font-black tracking-[-0.035em] text-[var(--ac-text)]">Кредитный калькулятор</h2><span className="text-xs font-semibold text-[var(--ac-muted)]">Сюда подключим форму партнёра.</span></div></div><span className="shrink-0 rounded-full bg-red-500/10 px-2.5 py-1 text-[10px] font-black normal-case tracking-normal text-red-500">Скоро</span></div>
      <div className="mt-3 grid grid-cols-3 gap-2">{[["Стоимость авто", "из карточки"], ["Первый взнос", "0 ₽"], ["Срок", "60 мес"]].map(([label, value]) => <div key={label} className="rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface)] px-3 py-2.5"><div className="text-[10px] font-bold text-[var(--ac-muted)]">{label}</div><div className="mt-0.5 text-sm font-black text-[var(--ac-text)]">{value}</div></div>)}</div>
      <div className="mt-2 flex items-stretch gap-2"><div className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl bg-red-500/10 px-3 py-2.5"><span className="text-xs font-black text-[var(--ac-text)]">Ежемесячный платёж</span><span className="text-lg font-black text-red-500">— ₽</span></div><a href={AUTOCREDIT_AFFILIATE_URL} target="_blank" rel={AFFILIATE_LINK_REL} className="ac-credit-partner-button inline-flex min-w-[176px] items-center justify-center rounded-xl bg-[#111318] px-4 py-2.5 text-xs font-black !text-white transition-[filter,transform] hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-[.99]">Подобрать кредит</a></div>
    </section>
  </div>;
}

export function OfferContactActionsStyles() {
  return <style dangerouslySetInnerHTML={{ __html: `
    html[data-theme="light"] .ac-offer-page .ac-offer-updated{background:#fff!important;border:1px solid var(--ac-border)!important}
    .ac-offer-contact-anchor{grid-column:1/-1;min-height:56px}
    .ac-offer-contact-anchor[data-stuck="true"]>button{z-index:45;box-shadow:0 6px 20px #0003}
    .ac-offer-action-row .ac-offer-contact-button{height:56px!important;font-size:16px!important;color:#fff!important}
    .ac-offer-action-row .ac-offer-contact-button>span{font-size:inherit!important}
    .ac-offer-action-row .ac-offer-contact-button>svg,
    .ac-offer-action-row .ac-offer-contact-button>span:has(>svg){left:20px!important;top:50%;transform:translateY(-50%)}
    .ac-offer-action-row [data-offer-pdf-slot] button{height:56px!important}
    .ac-offer-action-row [data-offer-pdf-slot] svg{width:21px;height:21px;flex-shrink:0}
    .ac-offer-action-row .ac-offer-contact-button>svg{display:block!important}
    .ac-offer-contact-button>span{font-size:inherit}
    .ac-credit-partner-button{color:#fff!important;-webkit-text-fill-color:#fff!important}
    .ac-offer-page [data-offer-credit-host]{display:none!important}
    .ac-offer-page>section>section{border-top:1px solid rgba(255,255,255,.085)!important;padding-top:1rem}
    html[data-theme="light"] .ac-offer-page>section>section{border-top-color:rgba(35,42,55,.12)!important}
    .ac-offer-favorite{width:56px!important;height:56px!important;border-radius:1.05rem!important;background:rgba(255,53,61,.09)!important;color:#ff353d!important}
    .ac-offer-favorite svg{width:26px;height:26px}
    @media(max-width:1279px){
      .ac-offer-action-row{grid-template-columns:minmax(0,1fr) 56px;gap:10px}
      .ac-offer-action-row>[data-offer-action="lead"]{grid-column:1/-1}
      .ac-offer-action-row[data-has-pdf="true"]{grid-template-columns:minmax(0,1fr) 76px 56px}
      .ac-offer-action-row [data-offer-pdf-slot] button{padding:0;gap:4px}
      .ac-offer-action-row .ac-offer-contact-button{padding-left:48px;padding-right:12px}
    }
    .ac-offer-action-row[data-has-copy="true"]{grid-template-columns:minmax(0,1fr) 56px 56px}
    .ac-offer-action-row[data-has-copy="true"][data-has-pdf="true"]{grid-template-columns:minmax(0,1fr) 56px 76px 56px}
    @media(max-width:767px){
      .ac-offer-action-row[data-has-copy="true"] .ac-offer-contact-button>svg{display:none!important}
      .ac-offer-action-row[data-has-copy="true"] .ac-offer-contact-button{padding-left:8px;padding-right:8px;font-size:13px!important}
    }
    @media(max-width:359px){
      .ac-offer-action-row{gap:8px}
      .ac-offer-action-row[data-has-pdf="true"]{grid-template-columns:minmax(0,1fr) 60px 44px}
      .ac-offer-action-row[data-has-copy="true"]{grid-template-columns:minmax(0,1fr) 44px 44px}
      .ac-offer-action-row[data-has-copy="true"][data-has-pdf="true"]{grid-template-columns:minmax(0,1fr) 44px 60px 44px}
      .ac-offer-action-row .ac-offer-copy{width:100%!important}
      .ac-offer-action-row .ac-offer-favorite{width:100%!important}
    }
    @media(min-width:1280px){
      .ac-offer-favorite{height:56px!important;width:56px!important}
      .ac-offer-actions-below{grid-template-columns:minmax(0,1.25fr) minmax(0,1fr) 56px}
      .ac-offer-actions-sidebar{grid-template-columns:minmax(0,1fr) 56px}
      .ac-offer-actions-sidebar>[data-offer-action="lead"]{grid-column:1/-1}
      .ac-offer-actions-sidebar[data-has-pdf="true"]{grid-template-columns:minmax(0,1fr) 80px 56px}
      .ac-offer-actions-sidebar .ac-offer-contact-button{padding-left:48px;padding-right:12px;font-size:16px}
      .ac-offer-actions-sidebar .ac-offer-contact-button>span>span:first-child{display:inline!important}
      .ac-offer-actions-sidebar .ac-offer-contact-button>span>span:last-child{display:none!important}
      .ac-offer-actions-sidebar [data-offer-pdf-slot] button{padding:0;gap:4px}


      .ac-offer-actions-below[data-has-pdf="true"]{grid-template-columns:minmax(0,1.25fr) minmax(0,1fr) 100px 56px}
      .ac-offer-actions-sidebar[data-has-copy="true"]{grid-template-columns:minmax(0,1fr) 56px 56px}
      .ac-offer-actions-sidebar[data-has-copy="true"][data-has-pdf="true"]{grid-template-columns:minmax(0,1fr) 56px 80px 56px}
      .ac-offer-actions-below[data-has-copy="true"]{grid-template-columns:minmax(0,1.25fr) minmax(0,1fr) 56px 56px}
      .ac-offer-actions-below[data-has-copy="true"][data-has-pdf="true"]{grid-template-columns:minmax(0,1.25fr) minmax(0,1fr) 56px 100px 56px}
      .ac-offer-actions-below[data-has-copy="true"] .ac-offer-contact-button{padding-left:48px;padding-right:12px;font-size:14px!important}
      .ac-offer-actions-below[data-has-copy="true"] .ac-offer-contact-button>svg,.ac-offer-actions-below[data-has-copy="true"] .ac-offer-contact-button>span:has(>svg){left:20px!important}
      .ac-offer-actions-below[data-has-copy="true"] .ac-offer-contact-button>span{white-space:normal!important}
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
