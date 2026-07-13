"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { AvtocenaCase } from "@/lib/avtocena";
import {
  captureAttributionFromBrowser,
  trackAttributionEvent,
  type AttributionData,
} from "@/lib/attribution";

type ResultCar = AvtocenaCase & {
  budgetDeltaRub?: number;
  isInBudget?: boolean;
};

type SearchRequest = {
  budgetRub?: number;
  brand?: string;
  model?: string;
  yearFrom?: number;
  market?: string;
  body?: string;
};

type LeadFormProps = {
  car: ResultCar;
  budgetRub?: number;
  attribution?: Partial<AttributionData>;
  searchRequest?: SearchRequest;
};

function money(value: number) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(value));
}

export function LeadForm({ car, budgetRub, attribution, searchRequest }: LeadFormProps) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    name: "",
    phone: "",
    city: "",
    comment: "",
  });

  const calculationKey = useMemo(
    () =>
      [
        searchRequest?.budgetRub || budgetRub || "",
        searchRequest?.brand || "",
        searchRequest?.model || "",
        searchRequest?.yearFrom || "",
        searchRequest?.market || "",
        searchRequest?.body || "",
      ].join("|"),
    [budgetRub, searchRequest],
  );

  useEffect(() => {
    const currentAttribution = captureAttributionFromBrowser(attribution);

    if (currentAttribution.clickId) {
      void trackAttributionEvent("calculation_completed", currentAttribution, {
        calculationKey,
        search: searchRequest || { budgetRub },
      });
    }
  }, [attribution, budgetRub, calculationKey, searchRequest]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function update(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!form.phone.trim()) {
      setError("Укажите телефон, чтобы менеджер смог связаться.");
      return;
    }

    if (!form.city.trim()) {
      setError("Укажите город, чтобы мы рассчитали доставку автомобиля.");
      return;
    }

    setLoading(true);

    try {
      const currentAttribution = captureAttributionFromBrowser(attribution);
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: form.name,
          phone: form.phone,
          city: form.city,
          comment: form.comment,
          carId: car.id,
          car: car.title,
          brand: car.brand,
          model: car.model,
          market: car.market,
          marketName: car.marketName,
          year: car.year,
          budgetRub,
          totalRub: car.totalRub,
          source: "results",
          attribution: currentAttribution,
          searchRequest: searchRequest || { budgetRub },
        }),
      });

      if (!response.ok) throw new Error("lead_error");
      setSent(true);
    } catch {
      setError("Не получилось отправить заявку. Попробуйте ещё раз.");
    } finally {
      setLoading(false);
    }
  }

  const modal =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            className="ac-viewport-modal fixed inset-0 z-[9999] flex items-end justify-center bg-black/82 backdrop-blur-[8px] md:items-center md:p-5"
            role="dialog"
            aria-modal="true"
            aria-label={`Заявка на ${car.title}`}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute inset-0"
              aria-label="Закрыть форму"
            />

            <div className="relative z-10 flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-[1.6rem] bg-[#10121a] shadow-[0_-30px_100px_rgba(0,0,0,0.65)] md:max-h-[calc(100dvh-40px)] md:max-w-[520px] md:rounded-[1.8rem] md:shadow-[0_30px_120px_rgba(0,0,0,0.72)]">
              <div className="ac-safe-bottom overflow-y-auto p-5 sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-xs font-black uppercase tracking-[0.18em] text-red-300">
                      Запрос цены
                    </div>
                    <h2 className="mt-2 text-2xl font-black leading-tight tracking-[-0.035em] text-white">
                      {car.title}
                    </h2>
                    <div className="mt-1 text-sm font-bold text-white/52">
                      {car.calculationComplete && car.totalRub ? `Ориентир: ${money(car.totalRub)} ₽` : `Цена площадки: ${money(car.sourcePriceLocal || 0)} ${car.sourceCurrency || car.currency || ""}`}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/8 text-white/72 transition hover:bg-white/12 hover:text-white"
                    aria-label="Закрыть"
                  >
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                      <path d="M3 3L15 15M15 3L3 15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>

                {sent ? (
                  <div className="mt-6 rounded-[1.25rem] bg-green-500/10 p-5">
                    <div className="text-xl font-black text-green-200">Заявка отправлена</div>
                    <p className="mt-2 text-sm font-bold leading-6 text-white/58">
                      Менеджер TopAvto свяжется с вами в ближайшее время.
                    </p>
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className="mt-5 w-full rounded-2xl bg-white/10 px-5 py-4 font-black text-white transition hover:bg-white/14"
                    >
                      Готово
                    </button>
                  </div>
                ) : (
                  <form onSubmit={submit} className="mt-6">
                    <div className="grid gap-3">
                      <input
                        value={form.name}
                        onChange={(event) => update("name", event.target.value)}
                        placeholder="Ваше имя"
                        className="soft-input w-full rounded-2xl px-4 py-3.5 text-sm font-bold"
                      />
                      <input
                        value={form.phone}
                        onChange={(event) => update("phone", event.target.value)}
                        placeholder="Телефон"
                        className="soft-input w-full rounded-2xl px-4 py-3.5 text-sm font-bold"
                      />
                      <input
                        value={form.city}
                        onChange={(event) => update("city", event.target.value)}
                        placeholder="Город"
                        autoComplete="address-level2"
                        className="soft-input w-full rounded-2xl px-4 py-3.5 text-sm font-bold"
                      />
                      <textarea
                        value={form.comment}
                        onChange={(event) => update("comment", event.target.value)}
                        placeholder="Комментарий"
                        rows={3}
                        className="soft-input w-full resize-none rounded-2xl px-4 py-3.5 text-sm font-bold"
                      />
                    </div>

                    {error && (
                      <div className="mt-3 rounded-2xl bg-red-500/15 px-4 py-3 text-sm font-bold text-red-100">
                        {error}
                      </div>
                    )}

                    <button
                      disabled={loading}
                      className="avto-button mt-4 w-full rounded-2xl px-5 py-4 font-black disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {loading ? "Отправляем..." : "Отправить заявку"}
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="avto-button w-full rounded-2xl px-5 py-4 text-center font-black"
      >
        {sent ? "Заявка отправлена" : "Получить предложение"}
      </button>
      {modal}
    </>
  );
}
