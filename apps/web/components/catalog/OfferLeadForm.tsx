"use client";

import { useMemo, useState } from "react";
import { captureAttributionFromBrowser } from "@/lib/attribution";

type Props = { offerId: string };

function newUuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function copyCurrentUrl() {
  const value = window.location.href;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fallback below.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  return copied;
}

async function shareCurrentUrl() {
  if (navigator.share) {
    try {
      await navigator.share({ title: document.title, url: window.location.href });
      return "shared" as const;
    } catch (error: any) {
      if (error?.name === "AbortError") return "idle" as const;
    }
  }
  return await copyCurrentUrl() ? "copied" as const : "error" as const;
}

export function OfferLeadForm({ offerId }: Props) {
  const storageKey = useMemo(() => `avtocena_offer_operation_${offerId}`, [offerId]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [shareStatus, setShareStatus] = useState<"idle" | "shared" | "copied" | "error">("idle");

  function getOperationId() {
    let value = sessionStorage.getItem(storageKey);
    if (!value) {
      value = newUuid();
      sessionStorage.setItem(storageKey, value);
    }
    return value;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("sending");
    setMessage("");
    const operationId = getOperationId();
    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operationId, offerId, name, phone, source: "catalog_offer", attribution: captureAttributionFromBrowser() }),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || "Не удалось отправить заявку");
      sessionStorage.removeItem(storageKey);
      setStatus("success");
      setMessage("Заявка отправлена. Менеджер проверит наличие и точную стоимость автомобиля.");
      setName("");
      setPhone("");
    } catch (error: any) {
      setStatus("error");
      setMessage(error?.message || "Ошибка сети. Повторная отправка не создаст дубль.");
    }
  }

  async function sendLink() {
    setShareStatus("idle");
    setShareStatus(await shareCurrentUrl());
  }

  if (status === "success") {
    return (
      <div className="mt-6 rounded-2xl bg-emerald-500/10 p-4 text-emerald-100">
        <div className="text-xs font-black uppercase tracking-[0.15em] text-emerald-300">Готово</div>
        <p className="mt-2 text-sm font-bold leading-6">{message}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-6 grid gap-3">
      <div className="mb-1">
        <div className="ac-muted-label text-xs font-black uppercase tracking-[0.16em] text-white/42">Запросить точный расчёт</div>
        <p className="mt-1 text-sm font-medium leading-6 text-white/48">Оставьте контакты — менеджер подтвердит наличие и итоговую цену.</p>
      </div>

      <label>
        <span className="ac-muted-label mb-1.5 block text-[11px] font-black uppercase tracking-[0.13em] text-white/38">Имя</span>
        <input value={name} onChange={(event) => setName(event.target.value)} name="name" placeholder="Как к вам обращаться" className="soft-input w-full rounded-2xl px-4 py-3.5" />
      </label>

      <label>
        <span className="ac-muted-label mb-1.5 block text-[11px] font-black uppercase tracking-[0.13em] text-white/38">Телефон</span>
        <input value={phone} onChange={(event) => setPhone(event.target.value)} name="phone" placeholder="Номер для связи" className="soft-input w-full rounded-2xl px-4 py-3.5" />
      </label>

      <button disabled={status === "sending"} className="avto-button ac-flat-button mt-1 rounded-2xl px-5 py-4 font-black disabled:opacity-60">
        {status === "sending" ? "Отправляем…" : "Оставить заявку"}
      </button>

      {message ? <div className="rounded-2xl bg-red-500/10 p-3 text-sm font-bold text-red-100">{message}</div> : null}

      <button type="button" onClick={sendLink} className="ac-flat-button flex items-center justify-center gap-2 rounded-2xl bg-white/[0.055] px-5 py-4 font-black text-white/78 transition hover:bg-white/[0.09] hover:text-white">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M10 13.5V2.8M6.2 6.6L10 2.8L13.8 6.6M4.2 9.2H3.5C2.7 9.2 2 9.9 2 10.7V16C2 17.1 2.9 18 4 18H16C17.1 18 18 17.1 18 16V10.7C18 9.9 17.3 9.2 16.5 9.2H15.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {shareStatus === "shared" ? "Ссылка отправлена" : shareStatus === "copied" ? "Ссылка скопирована" : shareStatus === "error" ? "Не удалось отправить" : "Отправить ссылку"}
      </button>
    </form>
  );
}
