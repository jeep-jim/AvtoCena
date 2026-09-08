"use client";

import { useState } from "react";
import { CurrencyRatesSheet, type PublicCurrencyRate } from "./PriceTrend";
import { JapanAuctionBadges } from "./JapanAuctionBadges";
import { sellerPriceLabel } from "../../lib/catalog/seller-price-contract";
import { useTapActivation } from "./useTapActivation";

export function SellerPrice({ offer, panel = true, dense = false, label, priceClassName = "text-3xl md:text-4xl" }: {
  offer: any; panel?: boolean; dense?: boolean; label?: string; priceClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const tap = useTapActivation();
  const price = Number(offer.sellerPriceRub);
  if (!Number.isFinite(price) || price <= 0) return null;
  const rate = offer.calculationSnapshot?.currencyRate as PublicCurrencyRate | undefined;
  const japan = offer.market === "japan";
  const priceLabel = sellerPriceLabel(offer);
  return <div className={panel ? "ac-offer-price-panel ac-price-trend-panel rounded-[1.35rem] bg-[var(--ac-surface-2)] p-4 text-[var(--ac-text)]" : "ac-price-trend relative min-w-0 text-[var(--ac-text)]"}>
    {label ? <div className={`${dense ? "text-[8px] sm:text-[10px]" : "text-[10px]"} font-black`}>{label}</div> : null}
    <div className={`${dense ? "text-[8px] sm:text-[10px]" : "text-[10px]"} font-bold uppercase tracking-wider text-[var(--ac-muted)]`}>{priceLabel}</div>
    <div className="mt-1.5 flex min-w-0 flex-wrap items-end justify-between gap-2">
      <span className={`ac-price ac-price--flat whitespace-nowrap font-black leading-none tracking-tight ${priceClassName}`}>{Math.round(price).toLocaleString("ru-RU")}<span className="ml-[0.18em] text-[0.58em]">₽</span></span>
      {japan ? <JapanAuctionBadges offer={offer} dense={dense} interactive={panel} /> : null}
    </div>
    <p className="mt-2 text-[10px] text-[var(--ac-muted)]">Без доставки и платежей</p>
    {panel && rate?.effectiveRate ? <>
      <button type="button" {...tap} onClick={()=>setOpen(true)} className="mt-3 min-h-10 w-full rounded-xl bg-white/5 px-3 py-2 text-left text-xs font-bold" aria-label={`Показать курс ${offer.sourceCurrency}`}>
        {Number(offer.sourcePrice).toLocaleString("ru-RU")} {offer.sourceCurrency} · Курс валюты →
      </button>
      <CurrencyRatesSheet open={open} onClose={()=>setOpen(false)} rates={[rate]} initialCurrency={offer.sourceCurrency} statusLabel="Курс для цены продавца · без доставки и платежей" />
    </> : null}
  </div>;
}
