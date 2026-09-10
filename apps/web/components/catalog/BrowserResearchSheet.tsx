"use client";

import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from "react";
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
 const [challenge, setChallenge] = useState(false), [directInput, setDirectInput] = useState(false), [directTouch, setDirectTouch] = useState(false);
 const gesture = useRef<{x:number;y:number}[]>([]);
 const stopRef = useRef<() => void>(() => {}), drag = useRef<number | null>(null);
 function close() { stopRef.current(); onClose(); }
 async function command(action: string, payload: Record<string, unknown> = {}) {
  if (dead.current || !session.current || commandBusy.current) return false;
  commandBusy.current = true;
  try {
   const res = await fetch(ENDPOINT, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({action, id: session.current, ...payload}), signal: controller.current?.signal});
   if (dead.current) return false;
   if (!res.ok) { const body = await res.json(); if (["input_not_focused","sensitive_input","invalid_pointer"].includes(body.error)) {setStatus(body.error === "sensitive_input" ? "Для входа в аккаунт откройте Яндекс по ссылке сверху." : "Сначала нажмите нужное поле на странице."); return false;} if (body.error === "browser_busy") { setStatus("Алиса обновляет ответ. Повторите действие через секунду."); return false; } throw Error(body.error); }
   const result = await res.json(); setChallenge(result.view === "challenge"); setStatus(""); return true;
  } catch (error) { if (!dead.current) { setStatus(ERRORS[(error as Error).message] || "Связь с браузером прервалась. Сессия завершена."); stopRef.current(); } return false; }
  finally { commandBusy.current = false; }
 }
 async function send(value: string) { if (!value.trim() || sending) return; setSending(true); const ok = await command("send", {text: value}); if (ok) setText(""); setSending(false); }
 async function submit(e: FormEvent) {
  e.preventDefault(); if(!text.trim() || sending)return;
  if(!challenge && !directInput){void send(text);return;}
  setSending(true); const ok=await command("input",{text,submit:true}); if(ok)setText(""); setSending(false);
 }
 function point(e: PointerEvent<HTMLImageElement>) {
  const box=e.currentTarget.getBoundingClientRect();
  return {x:Math.max(0,Math.min(419,(e.clientX-box.left)*420/box.width)),y:Math.max(0,Math.min(639,(e.clientY-box.top)*640/box.height))};
 }
 function pointerDown(e: PointerEvent<HTMLImageElement>) {if(!ready || !e.isPrimary)return; gesture.current=[point(e)]; e.currentTarget.setPointerCapture(e.pointerId);}
 function pointerMove(e: PointerEvent<HTMLImageElement>) {
  if(!gesture.current.length || !e.isPrimary)return;
  const p=point(e),last=gesture.current.at(-1)!;
  if(Math.hypot(p.x-last.x,p.y-last.y)<3)return;
  if(gesture.current.length>=31)gesture.current=gesture.current.filter((_,i)=>i%2===0);
  gesture.current.push(p);
 }
 function pointerUp(e: PointerEvent<HTMLImageElement>) {
  if(!gesture.current.length || !e.isPrimary)return;
  const path=gesture.current; gesture.current=[]; const end=point(e),start=path[0];
  const moved=Math.hypot(end.x-start.x,end.y-start.y)>10 || path.some(p=>Math.hypot(p.x-start.x,p.y-start.y)>10);
  if(!moved){void command("interact",{points:[end]});return;}
  if(challenge || directTouch || Math.abs(end.x-start.x)>Math.abs(end.y-start.y)){void command("interact",{points:[...path,end].slice(0,32)});return;}
  void command("scroll",{delta:Math.max(-900,Math.min(900,start.y-end.y))});
 }
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
   try { const res = await post("heartbeat"); const body = await res.json(); if (!res.ok || body.state === "failed") fail(body.error); else if (!disposed && body.state === "ready") {setReady(true); setChallenge(body.view === "challenge");} } catch { if (!disposed) fail("session_not_found"); } finally { hbBusy = false; }
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
  <section aria-label="Уточнение с Алисой" className="ac-browser-sheet absolute inset-x-0 bottom-0 mx-auto flex h-[80dvh] max-w-[620px] flex-col rounded-t-[30px] bg-transparent">
   <header className="relative shrink-0 touch-none rounded-t-[30px] bg-[var(--ac-surface)] px-5 pb-3 pt-5" onPointerDown={e => {if ((e.target as HTMLElement).closest("button, a")) return; drag.current = e.clientY; e.currentTarget.setPointerCapture(e.pointerId);}} onPointerUp={e => {if (drag.current !== null && e.clientY - drag.current > 90) close(); drag.current = null;}} onPointerCancel={() => {drag.current = null;}}>
    <span aria-hidden className="absolute -top-3 left-1/2 h-1.5 w-10 -translate-x-1/2 rounded-full bg-white/80" />
    <button type="button" onClick={close} aria-label="Закрыть и завершить сессию" className="absolute right-4 top-4 h-10 w-10 rounded-full bg-[var(--ac-surface-2)] text-xl">×</button>
    <p className="pr-12 text-xs text-[var(--ac-muted)]">{title}</p>
    <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 pr-12">
     <h2 className="text-lg font-bold">Уточнить с Алисой</h2>
     <a href={fallback} target="_blank" rel="noopener noreferrer" onClick={close} className="whitespace-nowrap text-xs text-violet-400 hover:text-violet-300">Открыть в Яндексе ↗</a>
    </div>
   </header>
   <div className="min-h-0 flex-1 overflow-y-auto bg-[#181818] text-white">
    {frame ? <img src={frame} alt="Страница Яндекса — нажмите для взаимодействия" draggable={false} className="mx-auto block h-auto w-full max-w-[420px] touch-none" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => {gesture.current=[];}} /> : <p role="status" className="p-6 text-sm">{status}</p>}

   </div>
   <footer className="shrink-0 space-y-2 bg-transparent px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
    {ready && <div className="flex flex-wrap items-center gap-2 text-xs">
     {challenge ? <span role="status" className="text-[var(--ac-muted)]">Пройдите проверку Яндекса в окне выше.</span> : <>
      <button type="button" onClick={() => void send("Покажи фотографии кузова этой модели с источниками.")} disabled={sending} className="rounded-full bg-[var(--ac-surface-2)] px-3 py-2">Фото кузова</button>
      <button type="button" aria-pressed={directInput} onClick={() => {setDirectInput(!directInput);setText("");}} className="rounded-full bg-[var(--ac-surface-2)] px-3 py-2">{directInput ? "Ввод на странице ✓" : "Ввод на странице"}</button>
      <button type="button" aria-pressed={directTouch} onClick={() => setDirectTouch(!directTouch)} className="rounded-full bg-[var(--ac-surface-2)] px-3 py-2">{directTouch ? "Жесты ✓" : "Жесты"}</button>
     </>}
     <button type="button" aria-label="Прокрутить страницу вверх" onClick={() => void command("scroll",{delta:-450})} className="rounded-full bg-[var(--ac-surface-2)] px-3 py-2">↑</button>
     <button type="button" aria-label="Прокрутить страницу вниз" onClick={() => void command("scroll",{delta:450})} className="rounded-full bg-[var(--ac-surface-2)] px-3 py-2">↓</button>
    </div>}
    {frame && status && <p role="status" className="text-xs text-[var(--ac-muted)]">{status}</p>}
    <form onSubmit={submit} data-no-route-loader="true" className="flex gap-2"><input aria-label="Уточняющий вопрос Алисе" placeholder={challenge ? "Текст проверки" : directInput ? "Введите текст в выбранное поле" : "Уточните вопрос"} value={text} onChange={e => setText(e.target.value)} maxLength={2500} disabled={!ready || sending} className="min-w-0 flex-1 rounded-full bg-[var(--ac-surface-2)] px-4 py-3 text-sm outline-violet-500" /><button type="submit" disabled={!ready || sending || !text.trim()} aria-label="Отправить вопрос" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-transparent opacity-100 transition-opacity disabled:opacity-35"><img src="/brands/alice.svg" alt="" aria-hidden="true" width={26} height={26} className="h-[26px] w-[26px]" /></button></form>
   </footer>
  </section>
 </dialog>, document.body);
}
