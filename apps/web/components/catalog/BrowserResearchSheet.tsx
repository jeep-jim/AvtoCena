"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";

const ENDPOINT = "/api/browser-pilot";
const ERRORS: Record<string, string> = {
 pilot_busy: "Оба окна пилота сейчас заняты. Попробуйте немного позже.",
 session_rate_limit: "Достигнут лимит запусков. Попробуйте позже.",
 session_already_open: "У вас уже открыта другая сессия. Закройте её перед новым запуском.",
 provider_blocked: "Яндекс ограничил доступ из облачного браузера. Сессия завершена.",
 composer_missing: "Интерфейс Алисы изменился. Сейчас можно открыть поиск по ссылке ниже.",
 session_not_found: "Сессия завершена из-за отсутствия активности или связи.",
 pilot_unavailable: "Чат пока недоступен.",
 browser_start_failed: "Не удалось запустить браузер. Попробуйте позже.",
};
export function BrowserResearchSheet({offerId, title, fallback, onClose}: {offerId: string; title: string; fallback: string; onClose: () => void}) {
 const dialog = useRef<HTMLDialogElement>(null), session = useRef<string | null>(null), dead = useRef(false);
 const controller = useRef<AbortController | null>(null), imageUrl = useRef<string | null>(null), commandBusy = useRef(false);
 const [status, setStatus] = useState("Открываем Алису…");
 const [frame, setFrame] = useState<string | null>(null), [ready, setReady] = useState(false), [text, setText] = useState(""), [sending, setSending] = useState(false);
 const stopRef = useRef<() => void>(() => {}), drag = useRef<number | null>(null), imageTouch = useRef<number | null>(null);
 function close() { stopRef.current(); onClose(); }
 async function command(action: string, payload: Record<string, unknown> = {}) {
  if (dead.current || !session.current || commandBusy.current) return false;
  commandBusy.current = true;
  try {
   const res = await fetch(ENDPOINT, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({action, id: session.current, ...payload}), signal: controller.current?.signal});
   if (dead.current) return false;
   if (!res.ok) { const body = await res.json(); if (body.error === "browser_busy") { setStatus("Алиса обновляет ответ. Повторите действие через секунду."); return false; } throw Error(body.error); }
   setStatus(""); return true;
  } catch (error) { if (!dead.current) { setStatus(ERRORS[(error as Error).message] || "Связь с браузером прервалась. Сессия завершена."); stopRef.current(); } return false; }
  finally { commandBusy.current = false; }
 }
 async function send(value: string) { if (!value.trim() || sending) return; setSending(true); const ok = await command("send", {text: value}); if (ok) setText(""); setSending(false); }
 function submit(e: FormEvent) { e.preventDefault(); void send(text); }
 useEffect(() => {
  let disposed = false;
  dead.current = false; const id = crypto.randomUUID(); session.current = id;
  const abort = new AbortController(); controller.current = abort;
  let heartbeat: ReturnType<typeof setInterval> | undefined, poll: ReturnType<typeof setTimeout> | undefined;
  let hbBusy = false;
  const previousBody = document.body.style.overflow, previousHtml = document.documentElement.style.overflow;
  document.body.style.overflow = "hidden"; document.documentElement.style.overflow = "hidden"; dialog.current?.showModal();
  function beacon() { const data = JSON.stringify({action: "close", id}); try { if (navigator.sendBeacon(ENDPOINT, new Blob([data], {type: "application/json"}))) return; } catch {} void fetch(ENDPOINT, {method: "POST", headers: {"Content-Type": "application/json"}, body: data, keepalive: true}).catch(() => {}); }
  function stop() { if (disposed) return; disposed = true; dead.current = true; abort.abort(); clearInterval(heartbeat); clearTimeout(poll); beacon(); setReady(false); if (imageUrl.current) { URL.revokeObjectURL(imageUrl.current); imageUrl.current = null; } setFrame(null); }
  stopRef.current = stop;
  function hidden() { if (document.visibilityState === "hidden") { stop(); onClose(); } }
  function leave() { stop(); onClose(); }
  document.addEventListener("visibilitychange", hidden); document.addEventListener("freeze", leave); window.addEventListener("pagehide", leave); window.addEventListener("offline", leave);
  function fail(error: string) { if (!disposed) { setStatus(ERRORS[error] || "Сессия завершена. Откройте окно заново или воспользуйтесь поиском."); stop(); } }
  async function post(action: string) { return fetch(ENDPOINT, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({action, id, ...(action === "create" ? {offerId} : {})}), signal: abort.signal}); }
  async function beat() {
   if (disposed || hbBusy) return; hbBusy = true;
   try { const res = await post("heartbeat"); const body = await res.json(); if (!res.ok || body.state === "failed") fail(body.error); else if (!disposed && body.state === "ready") setReady(true); } catch { if (!disposed) fail("session_not_found"); } finally { hbBusy = false; }
  }
  async function frames() {
   if (disposed) return;
   try {
    if (!commandBusy.current) {
     const res = await post("frame");
     if (res.ok) { const blob = await res.blob(); if (!disposed) { const url = URL.createObjectURL(blob); const old = imageUrl.current; imageUrl.current = url; setFrame(url); setReady(true); setStatus(""); if (old) URL.revokeObjectURL(old); } }
     else { const body = await res.json(); if (!["browser_starting", "browser_busy", "frame_rate_limit"].includes(body.error)) fail(body.error); }
    }
   } catch { if (!disposed) fail("session_not_found"); }
   if (!disposed) poll = setTimeout(frames, 1500);
  }
  void (async () => {
   try {
    // Establish ownership before launch so an early close can cancel creation.
    const availability = await fetch(ENDPOINT, {signal: abort.signal, cache: "no-store"});
    const available = await availability.json();
    if (disposed) return;
    if (!availability.ok || !available.enabled) { fail("pilot_unavailable"); return; }
    const res = await post("create");
    if (disposed) { beacon(); return; }
    const body = await res.json(); if (!res.ok) { fail(body.error); return; }
    heartbeat = setInterval(() => void beat(), 5000); void frames();
   } catch { if (!disposed) fail("pilot_unavailable"); }
  })();
  return () => { stop(); document.removeEventListener("visibilitychange", hidden); document.removeEventListener("freeze", leave); window.removeEventListener("pagehide", leave); window.removeEventListener("offline", leave); document.body.style.overflow = previousBody; document.documentElement.style.overflow = previousHtml; };
 }, [offerId]); // A session belongs to this mounted sheet; returning from background never resumes it.
 return createPortal(<dialog ref={dialog} onCancel={e => {e.preventDefault(); close();}} onClick={e => {if (e.target === e.currentTarget) close();}} className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-0 text-[var(--ac-text)] backdrop:bg-black/65 backdrop:backdrop-blur-md">
  <section aria-label="Уточнение с Алисой" className="ac-browser-sheet absolute inset-x-0 bottom-0 mx-auto flex h-[92dvh] max-w-[620px] flex-col rounded-t-[30px] border border-[var(--ac-border)] bg-[var(--ac-surface)] shadow-2xl">
   <header className="relative shrink-0 touch-none border-b border-[var(--ac-border)] px-5 pb-3 pt-5" onPointerDown={e => {if ((e.target as HTMLElement).closest("button")) return; drag.current = e.clientY; e.currentTarget.setPointerCapture(e.pointerId);}} onPointerUp={e => {if (drag.current !== null && e.clientY - drag.current > 90) close(); drag.current = null;}} onPointerCancel={() => {drag.current = null;}}>
    <span aria-hidden className="absolute -top-3 left-1/2 h-1.5 w-10 -translate-x-1/2 rounded-full bg-white/80" />
    <button type="button" onClick={close} aria-label="Закрыть и завершить сессию" className="absolute right-4 top-4 h-10 w-10 rounded-full bg-[var(--ac-surface-2)] text-xl">×</button>
    <p className="pr-12 text-xs text-[var(--ac-muted)]">{title}</p><h2 className="mt-1 text-lg font-bold">Уточнить с Алисой</h2>
   </header>
   <div className="min-h-0 flex-1 overflow-y-auto bg-[#181818] text-white">
    {frame ? <img src={frame} alt="Текущий ответ в браузере Алисы" draggable={false} className="mx-auto block h-auto w-full max-w-[420px] touch-pan-y" onPointerDown={e => {imageTouch.current = e.clientY; e.currentTarget.setPointerCapture(e.pointerId);}} onPointerUp={e => {const start = imageTouch.current; imageTouch.current = null; if (start !== null && Math.abs(start - e.clientY) > 15) void command("scroll", {delta: Math.max(-900, Math.min(900, (start - e.clientY) * 2))});}} onPointerCancel={() => {imageTouch.current = null;}} /> : <p role="status" className="p-6 text-sm">{status}</p>}
   </div>
   <footer className="shrink-0 space-y-2 border-t border-[var(--ac-border)] px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
    {ready && <div className="flex items-center gap-2 text-xs"><button type="button" onClick={() => void send("Покажи реальные фотографии кузова этой модели и укажи источники. Не выдавай фото примеров за фото конкретного лота.")} disabled={sending} className="rounded-full bg-[var(--ac-surface-2)] px-3 py-2">Фото кузова</button><button type="button" aria-label="Прокрутить ответ вверх" onClick={() => void command("scroll", {delta: -450})} className="rounded-full bg-[var(--ac-surface-2)] px-3 py-2">↑</button><button type="button" aria-label="Прокрутить ответ вниз" onClick={() => void command("scroll", {delta: 450})} className="rounded-full bg-[var(--ac-surface-2)] px-3 py-2">↓</button></div>}
    <form onSubmit={submit} data-no-route-loader="true" className="flex gap-2"><input aria-label="Уточняющий вопрос Алисе" placeholder="Уточните вопрос" value={text} onChange={e => setText(e.target.value)} maxLength={2500} disabled={!ready || sending} className="min-w-0 flex-1 rounded-full bg-[var(--ac-surface-2)] px-4 py-3 text-sm outline-violet-500" /><button type="submit" disabled={!ready || sending || !text.trim()} aria-label="Отправить вопрос" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--ac-surface-2)] disabled:opacity-40"><img src="/brands/alice.svg" alt="" aria-hidden="true" width={26} height={26} className="h-[26px] w-[26px]" /></button></form>
    {!ready && <a href={fallback} target="_blank" rel="noopener noreferrer" onClick={close} className="inline-block text-xs text-violet-500 underline">Открыть поиск в Яндексе ↗</a>}
   </footer>
  </section>
 </dialog>, document.body);
}
