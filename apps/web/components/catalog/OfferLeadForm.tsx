"use client";

import { useMemo, useState } from "react";
import { captureAttributionFromBrowser } from "@/lib/attribution";

type Props = { offerId: string };
function newUuid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
async function copyCurrentUrl() {
  const value = window.location.href;
  if (navigator.share) { try { await navigator.share({ title: document.title, url: value }); return true; } catch {} }
  if (navigator.clipboard?.writeText) { try { await navigator.clipboard.writeText(value); return true; } catch {} }
  const textarea = document.createElement("textarea"); textarea.value = value; textarea.setAttribute("readonly", ""); textarea.style.position = "fixed"; textarea.style.left = "-9999px"; document.body.appendChild(textarea); textarea.select(); const copied = document.execCommand("copy"); document.body.removeChild(textarea); return copied;
}

export function OfferLeadForm({ offerId }: Props) {
  const storageKey = useMemo(() => `avtocena_offer_operation_${offerId}`, [offerId]);
  const [name, setName] = useState(""); const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<"idle"|"sending"|"success"|"error">("idle");
  const [message, setMessage] = useState(""); const [copyStatus, setCopyStatus] = useState<"idle"|"success"|"error">("idle");
  function getOperationId() { let value = sessionStorage.getItem(storageKey); if (!value) { value = newUuid(); sessionStorage.setItem(storageKey, value); } return value; }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setStatus("sending"); setMessage("");
    try {
      const response = await fetch("/api/leads", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ operationId:getOperationId(), offerId, name, phone, source:"catalog_offer", attribution:captureAttributionFromBrowser() }) });
      const json = await response.json(); if (!response.ok || !json.ok) throw new Error(json.error || "Не удалось отправить заявку");
      sessionStorage.removeItem(storageKey); setStatus("success"); setMessage("Заявка отправлена. Менеджер проверит наличие и точную стоимость автомобиля."); setName(""); setPhone("");
    } catch (error:any) { setStatus("error"); setMessage(error?.message || "Ошибка сети. Повторная отправка не создаст дубль."); }
  }
  async function shareLink() { setCopyStatus("idle"); try { setCopyStatus(await copyCurrentUrl() ? "success" : "error"); } catch { setCopyStatus("error"); } }
  if (status === "success") return <div className="mt-6 rounded-2xl bg-emerald-500/10 p-4 text-emerald-100"><div className="text-xs font-black uppercase tracking-[0.15em] text-emerald-300">Готово</div><p className="mt-2 text-sm font-bold leading-6">{message}</p></div>;
  return <form onSubmit={submit} className="mt-6 grid gap-3 md:grid-cols-2">
    <div className="mb-1 md:col-span-2"><div className="text-xs font-black uppercase tracking-[0.16em] text-red-500">Запросить точный расчёт</div><p className="mt-1 text-sm font-medium leading-6 text-white/48">Оставьте контакты — менеджер подтвердит наличие и итоговую цену.</p></div>
    <label className="block min-w-0"><span className="mb-1.5 block text-[11px] font-black uppercase tracking-[0.13em] text-white/55">Имя</span><input value={name} onChange={(e)=>setName(e.target.value)} name="name" placeholder="Как к вам обращаться" className="soft-input w-full rounded-2xl px-4 py-3.5" /></label>
    <label className="block min-w-0"><span className="mb-1.5 block text-[11px] font-black uppercase tracking-[0.13em] text-white/55">Телефон</span><input value={phone} onChange={(e)=>setPhone(e.target.value)} name="phone" placeholder="Номер для связи" className="soft-input w-full rounded-2xl px-4 py-3.5" /></label>
    <button disabled={status === "sending"} className="avto-button mt-1 rounded-2xl px-5 py-4 font-black disabled:opacity-60 md:col-span-2">{status === "sending" ? "Отправляем…" : "Оставить заявку"}</button>
    {message ? <div className="rounded-2xl bg-red-500/10 p-3 text-sm font-bold text-red-100 md:col-span-2">{message}</div> : null}
    <button type="button" onClick={shareLink} className="flex items-center justify-center gap-2 rounded-2xl bg-white/[0.055] px-5 py-4 font-black text-white/78 transition hover:bg-white/[0.09] md:col-span-2"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12V20H20V12M12 16V3M7 8L12 3L17 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>{copyStatus === "success" ? "Ссылка отправлена" : copyStatus === "error" ? "Не удалось отправить" : "Отправить ссылку"}</button>
  </form>;
}
