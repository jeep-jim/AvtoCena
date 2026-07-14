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
      // Fallback below works in browsers where Clipboard API is blocked.
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

export function OfferLeadForm({ offerId }: Props) {
  const storageKey = useMemo(() => `avtocena_offer_operation_${offerId}`, [offerId]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [copyStatus, setCopyStatus] = useState<"idle" | "success" | "error">("idle");

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
        body: JSON.stringify({
          operationId,
          offerId,
          name,
          phone,
          source: "catalog_offer",
          attribution: captureAttributionFromBrowser(),
        }),
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

  async function saveLink() {
    setCopyStatus("idle");
    try {
      const copied = await copyCurrentUrl();
      setCopyStatus(copied ? "success" : "error");
    } catch {
      setCopyStatus("error");
    }
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
        <div className="text-xs font-black uppercase tracking-[0.16em] text-red-300">Запросить точный расчёт</div>
        <p className="mt-1 text-sm font-medium leading-6 text-white/48">Оставьте контакты — менеджер подтвердит наличие и итоговую цену.</p>
      </div>

      <label>
        <span className="mb-1.5 block text-[11px] font-black uppercase tracking-[0.13em] text-white/38">Имя</span>
        <input value={name} onChange={(event) => setName(event.target.value)} name="name" placeholder="Как к вам обращаться" className="soft-input w-full rounded-2xl px-4 py-3.5" />
      </label>

      <label>
        <span className="mb-1.5 block text-[11px] font-black uppercase tracking-[0.13em] text-white/38">Телефон</span>
        <input value={phone} onChange={(event) => setPhone(event.target.value)} name="phone" placeholder="Номер для связи" className="soft-input w-full rounded-2xl px-4 py-3.5" />
      </label>

      <button disabled={status === "sending"} className="avto-button mt-1 rounded-2xl px-5 py-4 font-black disabled:opacity-60">
        {status === "sending" ? "Отправляем…" : "Оставить заявку"}
      </button>

      {message ? <div className="rounded-2xl bg-red-500/10 p-3 text-sm font-bold text-red-100">{message}</div> : null}

      <button type="button" onClick={saveLink} className="flex items-center justify-center gap-2 rounded-2xl bg-white/[0.055] px-5 py-4 font-black text-white/78 transition hover:bg-white/[0.09] hover:text-white">
        <svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M8 12L12 8M6.5 13.5L4.8 15.2C3.5 16.5 1.5 16.5.3 15.2C-.9 14-.9 12 .3 10.8L3.4 7.7C4.6 6.5 6.6 6.5 7.8 7.7M13.5 6.5L15.2 4.8C16.5 3.5 18.5 3.5 19.7 4.8C20.9 6 20.9 8 19.7 9.2L16.6 12.3C15.4 13.5 13.4 13.5 12.2 12.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        {copyStatus === "success" ? "Ссылка скопирована" : copyStatus === "error" ? "Не удалось скопировать" : "Сохранить ссылку"}
      </button>
    </form>
  );
}
