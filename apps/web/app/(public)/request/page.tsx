"use client";

import { useState } from "react";
import Link from "next/link";
import { PublicHeader } from "@/components/layout/PublicHeader";

const CONSENT_VERSION = "telegram-request-v1-2026-08-14";
const CONSENT_TEXT = "Я даю согласие на обработку указанных мной персональных данных для обработки заявки и связи со мной.";

function cleanText(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function formatBudgetInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 12);
  return digits ? new Intl.NumberFormat("ru-RU").format(Number(digits)) : "";
}

export default function RequestPage() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [car, setCar] = useState("");
  const [budget, setBudget] = useState("");
  const [comment, setComment] = useState("");
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const digits = phone.replace(/\D/g, "");
    const budgetRub = Number(budget.replace(/\D/g, "")) || 0;
    if (!cleanText(name) || digits.length < 10 || !cleanText(city) || !cleanText(car)) {
      setStatus("error");
      setMessage("Заполните имя, город, автомобиль и корректный телефон.");
      return;
    }
    if (!consent) {
      setStatus("error");
      setMessage("Нужно дать согласие на обработку данных.");
      return;
    }

    setStatus("sending");
    setMessage("");
    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: cleanText(name),
          phone: cleanText(phone),
          city: cleanText(city),
          car: cleanText(car),
          budgetRub: budgetRub || undefined,
          comment: cleanText(comment),
          contactPreference: "call",
          source: "telegram_bot_site_request",
          personalDataConsent: true,
          personalDataConsentVersion: CONSENT_VERSION,
          personalDataConsentText: CONSENT_TEXT,
          utmSource: "telegram",
          utmMedium: "bot",
          utmCampaign: "public_bot_request",
          pageUrl: window.location.href,
          referrer: document.referrer,
          operationId: crypto.randomUUID(),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) throw new Error(String(result?.error || "request_failed"));
      setStatus("success");
      setMessage("Заявка отправлена. Менеджер АвтоЦены свяжется с вами.");
    } catch {
      setStatus("error");
      setMessage("Не удалось отправить заявку. Попробуйте ещё раз через несколько секунд.");
    }
  }

  return (
    <main className="ac-page-copy min-h-screen bg-[#1a2029] text-white">
      <PublicHeader />
      <section className="mx-auto w-full max-w-4xl px-4 py-10 md:px-8 md:py-14">
        <div className="rounded-[2rem] bg-[var(--ac-surface)] p-5 text-[var(--ac-text)] md:p-8">
          <div className="text-xs font-black uppercase tracking-[.18em] text-red-500">АвтоЦена</div>
          <h1 className="mt-2 text-3xl font-black tracking-[-.035em] md:text-5xl">Оставить заявку</h1>
          <p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-[var(--ac-muted)] md:text-base">
            Укажите, какой автомобиль нужен и ваш бюджет. Заявка попадёт в CRM АвтоЦены — менеджер проверит доступные рынки и свяжется с вами.
          </p>

          {status === "success" ? (
            <div className="mt-7 rounded-2xl bg-emerald-500/12 p-5">
              <div className="text-lg font-black text-emerald-500">✓ Заявка отправлена</div>
              <p className="mt-2 text-sm font-bold leading-6 text-[var(--ac-muted)]">{message}</p>
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                <Link href="/cars" className="ac-colored-button flex min-h-12 items-center justify-center rounded-xl bg-red-500 px-4 text-sm font-black text-white">Смотреть каталог</Link>
                <Link href="/" className="flex min-h-12 items-center justify-center rounded-xl bg-[var(--ac-surface-2)] px-4 text-sm font-black text-[var(--ac-text)]">На главную</Link>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-7 grid gap-4">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-1.5 text-sm font-black">Имя<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Как к вам обращаться" className="soft-input h-13 rounded-2xl bg-[var(--ac-surface-2)] px-4 font-semibold outline-none" /></label>
                <label className="grid gap-1.5 text-sm font-black">Телефон<input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+7 999 000-00-00" inputMode="tel" className="soft-input h-13 rounded-2xl bg-[var(--ac-surface-2)] px-4 font-semibold outline-none" /></label>
                <label className="grid gap-1.5 text-sm font-black">Город<input value={city} onChange={(event) => setCity(event.target.value)} placeholder="Например, Новокузнецк" className="soft-input h-13 rounded-2xl bg-[var(--ac-surface-2)] px-4 font-semibold outline-none" /></label>
                <label className="grid gap-1.5 text-sm font-black">Бюджет, ₽<input value={budget} onChange={(event) => setBudget(formatBudgetInput(event.target.value))} placeholder="2 000 000" inputMode="numeric" className="soft-input h-13 rounded-2xl bg-[var(--ac-surface-2)] px-4 font-semibold outline-none" /></label>
              </div>
              <label className="grid gap-1.5 text-sm font-black">Какой автомобиль интересует<input value={car} onChange={(event) => setCar(event.target.value)} placeholder="Например, Toyota RAV4 2022" className="soft-input h-13 rounded-2xl bg-[var(--ac-surface-2)] px-4 font-semibold outline-none" /></label>
              <label className="grid gap-1.5 text-sm font-black">Комментарий<textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Привод, цвет, комплектация, сроки или другие пожелания" className="soft-input min-h-28 resize-y rounded-2xl bg-[var(--ac-surface-2)] p-4 font-semibold outline-none" /></label>
              <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-[var(--ac-surface-2)] p-4 text-xs font-semibold leading-5 text-[var(--ac-muted)]">
                <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-red-500" />
                <span>{CONSENT_TEXT}</span>
              </label>
              {status === "error" ? <div className="rounded-xl bg-red-500/12 px-4 py-3 text-sm font-bold text-red-300">{message}</div> : null}
              <button type="submit" disabled={status === "sending"} className="ac-colored-button min-h-14 rounded-2xl bg-red-500 px-5 text-base font-black text-white disabled:opacity-60">
                {status === "sending" ? "Отправляем…" : "Отправить заявку"}
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
