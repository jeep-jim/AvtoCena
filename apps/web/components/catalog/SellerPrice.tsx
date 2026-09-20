"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CurrencyRatesSheet, RateDirectionIcon, type PublicCurrencyRate } from "./PriceTrend";
import { JapanAuctionBadges } from "./JapanAuctionBadges";
import { sellerPriceLabel } from "../../lib/catalog/seller-price-contract";
import { useTapActivation } from "./useTapActivation";

export function SellerPrice({ offer, deliveryCity = "", panel = true, dense = false, label, priceClassName = "text-3xl md:text-4xl" }: {
  offer: any; deliveryCity?: string; panel?: boolean; dense?: boolean; label?: string; priceClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const tap = useTapActivation();
  const price = Number(offer.sellerPriceRub);
  if (!Number.isFinite(price) || price <= 0) return null;
  const rate = offer.calculationSnapshot?.currencyRate as PublicCurrencyRate | undefined;
  const rateDelta = Number(rate?.rateDelta || (rate?.effectiveRate && rate?.previousEffectiveRate ? rate.effectiveRate-rate.previousEffectiveRate : 0));
  const japan = offer.market === "japan";
  const priceLabel = sellerPriceLabel(offer);
  return <div className={panel ? "relative ac-offer-price-panel ac-price-trend-panel rounded-[1.35rem] bg-[var(--ac-surface-2)] p-4 text-[var(--ac-text)]" : "ac-price-trend relative min-w-0 text-[var(--ac-text)]"}>
    <div className="flex min-w-0 items-center justify-between gap-1">
      {label ? <div className={`${dense ? "text-[8px] sm:text-[10px]" : "text-[10px]"} ac-price-trend-label shrink-0 whitespace-nowrap font-black`}>{label}</div> : null}
      <div className={`${dense ? "text-[8px] sm:text-[10px]" : "text-[10px]"} font-bold text-right text-[var(--ac-muted)] ${!panel ? "shrink-0 whitespace-nowrap" : "uppercase tracking-wider"}`}>{!panel && japan ? "Лот продан" : priceLabel}</div>
    </div>
    <div className={`${dense ? "mt-1 sm:mt-1.5" : "mt-1.5"} flex min-w-0 items-end justify-between gap-1 ${panel ? "flex-wrap" : "min-h-[22px] sm:min-h-[26px]"}`}>
      <span className={`ac-price ac-price--flat whitespace-nowrap font-black leading-none tracking-tight ${priceClassName}`}>{Math.round(price).toLocaleString("ru-RU")}<span className="ml-[0.18em] text-[0.58em]">₽</span></span>
      {panel ? <SellerPriceHelp /> : null}
      {japan ? <JapanAuctionBadges offer={offer} dense={dense} interactive={panel} /> : null}
    </div>
    {!panel && !japan ? <p className="mt-1 text-[10px] font-medium text-[var(--ac-muted)]">{deliveryCity ? `Доставка: ${deliveryCity} — после расчёта` : "Без доставки"}</p> : null}
    {panel ? <p className="mt-2 text-[10px] text-[var(--ac-muted)]">Без доставки и платежей</p> : null}
    {panel ? <style dangerouslySetInnerHTML={{ __html: `html[data-theme="light"] .ac-seller-currency{background:var(--ac-surface-2);border:1px solid var(--ac-border);color:var(--ac-text)}` }} /> : null}
    {panel && rate?.effectiveRate ? <>
      <button type="button" {...tap} onClick={()=>setOpen(true)} className="ac-seller-currency mt-3 flex min-h-10 w-full items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-2 text-left text-xs font-bold" aria-label={`Показать курс ${offer.sourceCurrency}`}>
        <span>{Number(offer.sourcePrice).toLocaleString("ru-RU")} {offer.sourceCurrency} · Курс валюты</span>
        {Number.isFinite(rateDelta) && rateDelta !== 0 ? <span aria-label={rateDelta<0?"Курс снизился":"Курс вырос"} style={{color:rateDelta<0?"#20a85e":"#ff3347"}}><RateDirectionIcon direction={rateDelta<0?"down":"up"} className="h-4 w-5 shrink-0" /></span> : <span aria-label="Курс без изменений">→</span>}
      </button>
      <CurrencyRatesSheet open={open} onClose={()=>setOpen(false)} rates={[rate]} initialCurrency={offer.sourceCurrency} statusLabel="Курс для цены продавца · без доставки и платежей" />
    </> : null}
  </div>;
}

function SellerPriceHelp() {
 const [open,setOpen]=useState(false);
 const id=useId();
 const panel=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const node=panel.current;
  const sync=()=>setOpen(Boolean(node?.matches(":popover-open")));
  node?.addEventListener("toggle",sync);
  return ()=>node?.removeEventListener("toggle",sync);
 },[]);
 function position(event: React.MouseEvent<HTMLButtonElement>) {
  const rect=event.currentTarget.getBoundingClientRect();
  const width=Math.min(430,window.innerWidth-32);
  if(panel.current){panel.current.style.left=`${Math.max(16,Math.min(rect.right-width,window.innerWidth-width-16))}px`;panel.current.style.top=`${Math.min(rect.bottom+12,Math.max(16,window.innerHeight-240))}px`;}
 }
 return <>
  <button type="button" popoverTarget={id} onClick={position} aria-label="Почему указана только цена продавца" aria-expanded={open} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black" style={{background:"var(--ac-surface-3)",border:"1px solid rgba(103,113,130,.45)",color:"var(--ac-text)"}}>?</button>
  <div ref={panel} id={id} popover="auto" className="fixed inset-auto m-0 w-[min(430px,calc(100vw-32px))] rounded-2xl border border-[var(--ac-border)] bg-[var(--ac-surface-2)] p-4 text-xs font-bold leading-5 text-[var(--ac-text)] shadow-2xl">
   Указана только цена автомобиля у продавца, без доставки и обязательных платежей. Для полного расчёта не хватает подтверждённых параметров. Уточните их в плитках ниже — стоимость пересчитается автоматически. Финальные данные подтвердит менеджер.
   <button type="button" popoverTarget={id} popoverTargetAction="hide" className="mt-3 block min-h-11 w-full rounded-xl bg-[var(--ac-surface)]">Понятно</button>
  </div>
 </>;
}
