"use client";
import { useMemo, useState } from "react";

type Props = { offerId: string };
function newUuid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
export function OfferLeadForm({ offerId }: Props) {
  const storageKey = useMemo(() => `avtocena_offer_operation_${offerId}`, [offerId]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  function getOperationId() { let value = sessionStorage.getItem(storageKey); if (!value) { value = newUuid(); sessionStorage.setItem(storageKey, value); } return value; }
  async function submit(e: React.FormEvent) { e.preventDefault(); setStatus("sending"); setMessage(""); const operationId = getOperationId(); try { const res = await fetch("/api/leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operationId, offerId, name, phone, source: "catalog_offer" }) }); const json = await res.json(); if (!res.ok || !json.ok) throw new Error(json.error || "Не удалось отправить заявку"); sessionStorage.removeItem(storageKey); setStatus("success"); setMessage("Заявка отправлена. Менеджер проверит наличие и точную стоимость автомобиля."); setName(""); setPhone(""); } catch (error: any) { setStatus("error"); setMessage(error?.message || "Ошибка сети. Повторная отправка использует тот же номер операции и не создаст дубль."); } }
  if (status === "success") return <div className="mt-6 rounded-2xl bg-emerald-500/10 p-4 text-emerald-100">{message}</div>;
  return <form onSubmit={submit} className="mt-6 grid gap-3"><input value={name} onChange={(e)=>setName(e.target.value)} name="name" placeholder="Имя" className="soft-input rounded-2xl px-4 py-3"/><input value={phone} onChange={(e)=>setPhone(e.target.value)} name="phone" placeholder="Телефон" className="soft-input rounded-2xl px-4 py-3"/><button disabled={status==="sending"} className="avto-button rounded-2xl px-5 py-4 font-black">{status==="sending" ? "Отправляем…" : "Оставить заявку"}</button>{message && <div className="rounded-2xl bg-red-500/10 p-3 text-sm text-red-100">{message}</div>}<button type="button" onClick={() => navigator.clipboard?.writeText(location.href)} className="rounded-2xl border border-white/15 px-5 py-4 font-black">Сохранить ссылку</button></form>;
}
