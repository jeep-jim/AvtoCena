"use client";

import { useState } from "react";
import { CatalogFilters } from "./CatalogFilters";
import { OfferCalculationForm } from "./OfferCalculationForm";
import { SellerPrice } from "./SellerPrice";
import { PriceTrend } from "./PriceTrend";
import { PreliminaryPrice } from "./PreliminaryPrice";
import { PublicHeader } from "../layout/PublicHeader";

// Development-only visual fixture. No inventory, pricing or lead requests.
export function CatalogDesignPreview() {
  const [notice, setNotice] = useState("");
  return <main className="ac-page-copy ac-cars-page min-h-screen px-4 pb-12 text-[var(--ac-text)]">
    <PublicHeader />
    <div className="mx-auto max-w-[1200px] pt-8">
      <p className="text-xs font-semibold text-[var(--ac-muted)]">Макет интерфейса · демонстрационные данные</p>
      <h1 className="mt-2 text-3xl font-black tracking-tight md:text-5xl">Каталог автомобилей</h1>
      <CatalogFilters initial={{ advanced: "1" }} facets={{ makes: ["Suzuki", "Kia", "Toyota"], models: [], markets: ["korea", "china", "uae", "europe", "georgia"], fuels: ["petrol", "diesel", "hybrid", "electric"], bodyTypes: ["sedan", "suv", "hatchback"], transmissions: ["automatic", "manual"], drives: ["fwd", "awd"] }} />
      <div className="mt-12 grid items-start gap-8 border-t border-[var(--ac-border)] pt-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--ac-muted)]">Пример карточки без полного расчёта</p>
          <h2 className="mt-2 text-3xl font-black">Suzuki Swift GLX</h2>
          <div className="mt-5 flex min-h-48 items-center justify-center rounded-2xl bg-[var(--ac-surface-2)] text-sm text-[var(--ac-muted)]">Фотографии исходного объявления</div>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold"><span>2024 г.</span><span>84 000 км</span><span>Автомат</span></div>
          <p className="mt-3 text-sm leading-6 text-[var(--ac-muted)]">Для расчёта под ключ нужно уточнить характеристики автомобиля.</p>
        </div>
        <div className="min-w-0">
          <SellerPrice sellerPriceRub={821284} sourceLabel="39 500 AED · пример пересчёта" />
          <div className="mt-5"><OfferCalculationForm initial={{ year: "2024" }} onCalculate={() => setNotice("Макет: параметры заполнены. Расчётный движок будет подключён отдельно.")} onManager={() => setNotice("Макет: здесь открывается существующая форма заявки менеджеру.")} /></div>
          {notice ? <p role="status" className="mt-3 text-sm text-[var(--ac-muted)]">{notice}</p> : null}
        </div>
      </div>
      <section className="mt-20 grid gap-8 border-t border-[var(--ac-border)] pt-8 md:grid-cols-2" aria-label="Проверка нажатия и прокрутки">
        <PriceTrend panel label="Ориентир стоимости" offer={{ market: "uae", totalRub: 2376520, sourcePrice: 39500, sourceCurrency: "AED", calculationSnapshot: { currencyRate: { currency: "AED", effectiveRate: 20.79, previousEffectiveRate: 20.8, rateDelta: -0.01, rateDate: "2026-09-08" } } }} />
        <PreliminaryPrice panel label="Предварительно от" offer={{ totalRub: 2376520 }} />
      </section>
      <div className="h-[700px]" aria-hidden="true" />
    </div>
  </main>;
}
