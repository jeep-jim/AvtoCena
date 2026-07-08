"use client";

import { useState } from "react";
import type { AvtocenaCase } from "@/lib/avtocena";

type ResultCar = AvtocenaCase & {
  budgetDeltaRub?: number;
  isInBudget?: boolean;
};

type LeadFormProps = {
  car: ResultCar;
  budgetRub?: number;
  partnerRef?: string;
};

function money(value: number) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(value));
}

export function LeadForm({ car, budgetRub, partnerRef }: LeadFormProps) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    name: "",
    phone: "",
    telegram: "",
    comment: ""
  });

  function update(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function getPartnerRef() {
    if (partnerRef) return partnerRef;

    try {
      const fromUrl = new URL(window.location.href).searchParams.get("ref");
      const fromStorage = window.localStorage.getItem("avtocena_ref");
      return fromUrl || fromStorage || "";
    } catch {
      return "";
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!form.phone.trim() && !form.telegram.trim()) {
      setError("Укажите телефон или Telegram, чтобы менеджер смог связаться.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: form.name,
          phone: form.phone,
          telegram: form.telegram,
          comment: form.comment,
          carId: car.id,
          car: car.title,
          market: car.market,
          marketName: car.marketName,
          year: car.year,
          budgetRub,
          totalRub: car.totalRub,
          partnerRef: getPartnerRef(),
          source: "results"
        })
      });

      if (!response.ok) {
        throw new Error("lead_error");
      }

      setSent(true);
    } catch {
      setError("Не получилось отправить заявку. Проверьте dev-сервер и попробуйте ещё раз.");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="mt-5 rounded-2xl border border-green-400/30 bg-green-500/10 p-4">
        <div className="text-lg font-black text-green-200">Заявка отправлена</div>
        <p className="mt-1 text-sm font-bold text-white/58">
          Лид сохранён в CRM. Проверьте раздел /crm/leads.
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="avto-button mt-5 w-full rounded-2xl px-5 py-4 text-center font-black"
      >
        Получить предложение
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="mt-5 rounded-[1.4rem] border border-white/12 bg-white/7 p-4">
      <div className="text-sm font-black text-white/70">
        Заявка на {car.title} · {money(car.totalRub)} ₽
      </div>

      <div className="mt-4 grid gap-3">
        <input
          value={form.name}
          onChange={(event) => update("name", event.target.value)}
          placeholder="Ваше имя"
          className="soft-input rounded-2xl px-4 py-3 text-sm font-bold"
        />

        <input
          value={form.phone}
          onChange={(event) => update("phone", event.target.value)}
          placeholder="Телефон"
          className="soft-input rounded-2xl px-4 py-3 text-sm font-bold"
        />

        <input
          value={form.telegram}
          onChange={(event) => update("telegram", event.target.value)}
          placeholder="Telegram"
          className="soft-input rounded-2xl px-4 py-3 text-sm font-bold"
        />

        <textarea
          value={form.comment}
          onChange={(event) => update("comment", event.target.value)}
          placeholder="Комментарий"
          rows={3}
          className="soft-input resize-none rounded-2xl px-4 py-3 text-sm font-bold"
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

      <button
        type="button"
        onClick={() => setOpen(false)}
        className="mt-3 w-full rounded-2xl bg-white/8 px-5 py-3 text-sm font-black text-white/60"
      >
        Закрыть
      </button>
    </form>
  );
}
