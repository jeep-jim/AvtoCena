"use client";
import {useDealerBrowsing} from "@/components/dealers/DealerBrowsingContext";
import {offerShareTitle,offerShareUrl} from "../../lib/catalog/offer-share";
import {useState} from "react";
import {miniAppOfferShareUrl} from "../../lib/telegram-miniapp";
import {offerRouteId} from "../../lib/catalog/offer-url";
export function ShareLinkButton({className = "", compactMobile = false, iconOnly = false}: {className?: string; compactMobile?: boolean; iconOnly?: boolean}) {
  const dealer=useDealerBrowsing();
  const [status,setStatus]=useState("");
  async function share() {
    const page=document.querySelector<HTMLElement>("[data-offer-id]");
    const parameters=page?.querySelector<HTMLElement>(".ac-inline-parameters");
    if(parameters?.dataset.shareError){setStatus("Проверьте параметры расчёта");return;}
    if(parameters?.dataset.sharePending){setStatus("Дождитесь пересчёта");return;}
    const savedVersion=page?.dataset.offerSavedVersion || document.querySelector<HTMLElement>("[data-offer-saved-version]")?.dataset.offerSavedVersion;
    const target = new URL(offerShareUrl(window.location.href,document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || null,savedVersion));
    target.searchParams.set("share","2");
    const estimate=parameters?.dataset.shareEstimate;
    if(savedVersion)target.searchParams.delete("estimate");
    if(estimate&&!savedVersion){target.searchParams.delete('calculation');target.searchParams.delete('direct');target.searchParams.set('estimate',estimate);}
    if(dealer&&!dealer.preview)target.searchParams.set("dealer",dealer.id);
    const price=parameters?.querySelector(".ac-offer-price-panel .ac-price")?.textContent;
    const totalRub=price ? (price.includes('₽')?Number(price.replace(/[^\d,.-]/g,'').replace(',','.')):null) : parameters ? null : Number(page?.dataset.offerPriceRub);
    const title=page?.dataset.offerShareName ? offerShareTitle({title:page.dataset.offerShareName,year:parameters?.dataset.shareYear||page.dataset.offerShareYear,engineCc:parameters?.dataset.shareEngineCc||page.dataset.offerShareEngineCc,fuel:parameters?.dataset.shareFuel||page.dataset.offerShareFuel,totalRub}) : document.title;
    const inMini=document.documentElement.dataset.miniapp==="true";
    const offerId=document.querySelector<HTMLElement>("[data-offer-id]")?.dataset.offerId || (target.pathname.startsWith("/cars/offer/") ? offerRouteId(decodeURIComponent(target.pathname.slice("/cars/offer/".length))) : "");
    const url=(inMini && offerId && !dealer && !estimate ? miniAppOfferShareUrl(offerId,savedVersion) : null) || target.toString();
    if(inMini && offerId){
      try{await navigator.clipboard.writeText(url.startsWith("https://t.me/") ? `${title}\n${url}` : url);setStatus("Ссылка скопирована");return;}catch{}
    }
    if(navigator.share) {try {await navigator.share({url});setStatus("");return;} catch(error) {if((error as Error).name === "AbortError") return;}}
    try {await navigator.clipboard.writeText(url);setStatus("Ссылка скопирована");}
    catch {setStatus(inMini ? "Не удалось скопировать ссылку" : "Скопируйте адрес из строки браузера");}
  }
  if(iconOnly) return <button type="button" onClick={share} className={className} aria-label="Поделиться автомобилем" title={status || "Поделиться автомобилем"}><svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12v8h16v-8M12 16V3m-5 5 5-5 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg><span className="sr-only" aria-live="polite">{status}</span></button>;
  return <button type="button" onClick={share} className={`relative min-w-0 ${className}`}><svg className={`pointer-events-none absolute left-4 shrink-0 xl:left-5 ${compactMobile ? "hidden md:block" : "block"}`} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12v8h16v-8M12 16V3m-5 5 5-5 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg><span className={`min-w-0 text-center text-[13px] sm:text-sm md:text-base ${status ? "" : "whitespace-nowrap"}`} aria-live="polite">{status || (compactMobile ? <><span className="md:hidden">Поделиться</span><span className="hidden md:inline">Поделиться ссылкой</span></> : "Поделиться ссылкой")}</span></button>;
}
