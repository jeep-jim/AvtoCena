"use client";

import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { captureAttributionFromBrowser } from "@/lib/attribution";

type FavoriteLeadItem = {
  id: string;
  title?: string;
  totalRub?: number | null;
  price?: number | null;
  imageUrl?: string;
  year?: number;
  marketLabel?: string;
  href?: string;
};

type HostKind = "home" | "catalog" | "brand";
type HostTarget = { kind: HostKind; node: HTMLElement };
type LeadRequest =
  | { mode: "generic"; source: string; car?: string }
  | { mode: "offer"; source: string; offerId: string; car?: string }
  | { mode: "favorites"; source: string };

type Suggestion = { id?: string; make?: string; model?: string; label?: string };
type ContactPreference = "call" | "message";
type MessengerKind = "telegram" | "max";
type LeadFormState = { city: string; name: string; phone: string; car: string; budget: string; comment: string };

const FAVORITES_KEY = "avtocena_favorites";
const CONSENT_VERSION = "lead-form-v2-2026-08-09";
const MOSCOW_HOURS = "06:00–15:00 МСК";

function cleanText(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function newUuid() {
  try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

function isPlausiblePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return false;
  if ((digits.startsWith("7") || digits.startsWith("8")) && digits.length !== 11) return false;
  return true;
}

function readFavorites(): FavoriteLeadItem[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(FAVORITES_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object" && cleanText(item.id)) : [];
  } catch {
    return [];
  }
}

function initialCity() {
  try {
    const query = new URLSearchParams(window.location.search).get("city");
    if (cleanText(query)) return cleanText(query);
    const cookie = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("avtocena_city="));
    if (cookie) return decodeURIComponent(cookie.slice("avtocena_city=".length));
  } catch { /* storage may be unavailable */ }
  return "";
}

function formatRub(value: number) {
  return `${new Intl.NumberFormat("ru-RU").format(Math.round(value))} ₽`;
}

function formatBudgetInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 12);
  return digits ? new Intl.NumberFormat("ru-RU").format(Number(digits)) : "";
}

function operationIdFor(request: LeadRequest, selectedIds: string[]) {
  const scope = request.mode === "offer" ? request.offerId : request.mode === "favorites" ? selectedIds.slice().sort().join("_") || "none" : request.source;
  const key = `avtocena_lead_operation_${request.mode}_${scope}`.slice(0, 220);
  try {
    let value = window.sessionStorage.getItem(key);
    if (!value) { value = newUuid(); window.sessionStorage.setItem(key, value); }
    return { key, value };
  } catch {
    return { key: "", value: newUuid() };
  }
}

function clearOperationId(key: string) {
  if (!key) return;
  try { window.sessionStorage.removeItem(key); } catch { /* ignore */ }
}

function GenericLeadBanner({ kind, onOpen }: { kind: HostKind; onOpen: () => void }) {
  const headline = kind === "brand" ? "Не нашли нужную комплектацию?" : "Не нашли нужный автомобиль?";
  return (
    <section className="ac-lead-capture-banner mt-8 grid gap-4 rounded-[1.7rem] bg-[var(--ac-surface)] p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:p-6">
      <div className="min-w-0">
        <div className="text-xs font-black uppercase tracking-[.16em] text-red-500">Подберём вручную</div>
        <h2 className="mt-1.5 text-2xl font-black tracking-[-.025em] text-[var(--ac-text)] md:text-3xl">{headline}</h2>
        <p className="mt-2 max-w-4xl text-sm font-medium leading-6 text-[var(--ac-muted)] md:text-base">На сайте показана только часть доступных вариантов. Оставьте заявку — подберём и рассчитаем автомобиль под ваш запрос, даже если его сейчас нет в каталоге.</p>
      </div>
      <button type="button" onClick={onOpen} className="avto-button ac-colored-button min-h-[52px] rounded-2xl px-6 py-3.5 text-sm font-black md:min-w-48 md:text-base">Оставить заявку</button>
    </section>
  );
}

function FavoriteSelector({ items, selectedIds, onToggle }: { items: FavoriteLeadItem[]; selectedIds: string[]; onToggle: (id: string) => void }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div><div className="text-[11px] font-black uppercase tracking-[.14em] text-[var(--ac-muted)]">Автомобили</div><p className="mt-1 text-sm font-bold text-[var(--ac-text)]">Выберите до 5 вариантов из Избранного</p></div>
        <span className="rounded-full bg-[var(--ac-surface-2)] px-3 py-1.5 text-xs font-black text-[var(--ac-muted)]">{selectedIds.length}/5</span>
      </div>
      <div className="ac-lead-favorites-list mt-3 grid max-h-64 gap-2 overflow-y-auto pr-1">
        {items.map((item) => {
          const selected = selectedIds.includes(item.id);
          const disabled = !selected && selectedIds.length >= 5;
          const price = Number(item.totalRub ?? item.price ?? 0);
          return <button key={item.id} type="button" disabled={disabled} onClick={() => onToggle(item.id)} className={`grid grid-cols-[54px_minmax(0,1fr)_26px] items-center gap-3 rounded-2xl p-2.5 text-left transition ${selected ? "bg-red-500/10" : "bg-[var(--ac-surface-2)]"} disabled:opacity-45`} aria-pressed={selected}>
            <div className="h-[54px] w-[54px] overflow-hidden rounded-xl bg-[var(--ac-surface-3)]">{item.imageUrl ? <img src={item.imageUrl} alt="" className="h-full w-full object-cover" /> : null}</div>
            <div className="min-w-0"><div className="truncate text-sm font-black text-[var(--ac-text)]">{cleanText(item.title) || "Автомобиль"}</div><div className="mt-1 flex flex-wrap gap-x-2 text-xs font-bold text-[var(--ac-muted)]">{item.year ? <span>{item.year}</span> : null}{price > 0 ? <span>{formatRub(price)}</span> : null}</div></div>
            <span className={`flex h-6 w-6 items-center justify-center rounded-lg border text-xs font-black ${selected ? "border-red-500 bg-red-500 text-white" : "border-[var(--ac-border)] text-transparent"}`}>✓</span>
          </button>;
        })}
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="mb-1.5 block text-[11px] font-black uppercase tracking-[.13em] text-[var(--ac-muted)]">{children}</span>;
}

function ContactChoice({ value, onChange }: { value: ContactPreference; onChange: (value: ContactPreference) => void }) {
  return <div className="rounded-2xl bg-[var(--ac-surface-2)] p-2"><div className="grid grid-cols-2 gap-2">
    <button type="button" onClick={() => onChange("call")} className={`min-h-11 rounded-xl px-3 text-sm font-black ${value === "call" ? "ac-colored-button bg-red-500" : "text-[var(--ac-muted)]"}`}>Позвонить</button>
    <button type="button" onClick={() => onChange("message")} className={`min-h-11 rounded-xl px-3 text-sm font-black ${value === "message" ? "ac-colored-button bg-red-500" : "text-[var(--ac-muted)]"}`}>Написать в чат</button>
  </div></div>;
}

function MessengerFields({ messenger, setMessenger, contact, setContact }: { messenger: MessengerKind; setMessenger: (value: MessengerKind) => void; contact: string; setContact: (value: string) => void }) {
  return <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
    <div><FieldLabel>Мессенджер</FieldLabel><div className="grid h-[52px] grid-cols-2 gap-1 rounded-2xl bg-[var(--ac-surface-2)] p-1">
      <button type="button" onClick={() => setMessenger("telegram")} className={`rounded-xl text-sm font-black ${messenger === "telegram" ? "ac-colored-button bg-[#229ED9]" : "text-[var(--ac-muted)]"}`}>Telegram</button>
      <button type="button" onClick={() => setMessenger("max")} className={`rounded-xl text-sm font-black ${messenger === "max" ? "ac-colored-button bg-[#7B61FF]" : "text-[var(--ac-muted)]"}`}>MAX</button>
    </div></div>
    <label className="block min-w-0"><FieldLabel>{messenger === "telegram" ? "Telegram" : "MAX"}</FieldLabel><input value={contact} onChange={(event) => setContact(event.target.value)} placeholder={messenger === "telegram" ? "@username или номер" : "Имя/номер в MAX"} className="soft-input h-[52px] w-full rounded-2xl bg-[var(--ac-surface-2)] px-4 outline-none" /></label>
  </div>;
}

function LeadDialog({ request, favorites, onClose }: { request: LeadRequest; favorites: FavoriteLeadItem[]; onClose: () => void }) {
  const panelRef = useRef<HTMLElement>(null);
  const [form, setForm] = useState<LeadFormState>(() => ({ city: initialCity(), name: "", phone: "", car: request.mode === "offer" || request.mode === "generic" ? cleanText(request.car) : "", budget: "", comment: "" }));
  const [contactPreference, setContactPreference] = useState<ContactPreference>("call");
  const [messenger, setMessenger] = useState<MessengerKind>("telegram");
  const [messengerContact, setMessengerContact] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [carFocused, setCarFocused] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const isFavorites = request.mode === "favorites";
  const isOffer = request.mode === "offer";
  const selectedFavorites = useMemo(() => favorites.filter((item) => selectedIds.includes(item.id)), [favorites, selectedIds]);
  const budgetRub = Number(form.budget.replace(/\D/g, "")) || 0;

  useEffect(() => {
    if (request.mode !== "generic") return;
    const query = cleanText(form.car);
    if (query.length < 2) { setSuggestions([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/catalog/models?q=${encodeURIComponent(query)}&limit=10`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json();
        setSuggestions(Array.isArray(data?.items) ? data.items : []);
      } catch (error) { if ((error as Error)?.name !== "AbortError") setSuggestions([]); }
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [form.car, request.mode]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape" && status !== "sending") onClose(); };
    window.addEventListener("keydown", keydown);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", keydown); };
  }, [onClose, status]);

  useEffect(() => {
    if (status === "success") panelRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [status]);

  const setField = (key: keyof LeadFormState, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const toggleFavorite = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 5 ? [...current, id] : current);

  function validate() {
    if (!cleanText(form.city)) return "Укажите ваш город.";
    if (!cleanText(form.name)) return "Укажите имя.";
    if (isFavorites && !selectedIds.length) return "Выберите хотя бы один автомобиль из Избранного.";
    if (contactPreference === "call") {
      if (!cleanText(form.phone)) return "Укажите телефон для звонка.";
      if (!isPlausiblePhone(form.phone)) return "Проверьте номер телефона: введите корректный номер не короче 10 цифр.";
    } else if (!cleanText(messengerContact)) {
      return `Укажите контакт в ${messenger === "telegram" ? "Telegram" : "MAX"}.`;
    }
    if (!isOffer && !isFavorites && !cleanText(form.car)) return "Укажите интересующий автомобиль.";
    if (!isOffer && !isFavorites && budgetRub <= 0) return "Укажите бюджет.";
    if (!consent) return "Нужно дать согласие на обработку персональных данных для отправки заявки.";
    return "";
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const validation = validate();
    if (validation) { setStatus("error"); setMessage(validation); return; }
    setStatus("sending"); setMessage("");

    const operation = operationIdFor(request, selectedIds);
    const carText = isFavorites ? selectedFavorites.map((item) => cleanText(item.title) || item.id).join("; ") : cleanText(form.car);
    const telegram = contactPreference === "message" && messenger === "telegram" ? cleanText(messengerContact) : "";
    const max = contactPreference === "message" && messenger === "max" ? cleanText(messengerContact) : "";

    try {
      const response = await fetch("/api/leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        operationId: operation.value,
        offerId: isOffer ? request.offerId : "",
        name: cleanText(form.name),
        phone: contactPreference === "call" ? cleanText(form.phone) : "",
        telegram,
        max,
        city: cleanText(form.city),
        car: carText,
        budgetRub: !isOffer && !isFavorites ? budgetRub : null,
        comment: cleanText(form.comment),
        source: request.source,
        contactPreference,
        messenger: contactPreference === "message" ? messenger : "",
        selectedOfferIds: isFavorites ? selectedIds : [],
        selectedOffers: isFavorites ? selectedFavorites.slice(0, 5).map((item) => ({ id: item.id, title: cleanText(item.title), totalRub: Number(item.totalRub ?? item.price ?? 0) || null, year: item.year || null, marketLabel: cleanText(item.marketLabel), href: cleanText(item.href) })) : [],
        personalDataConsent: true,
        personalDataConsentVersion: CONSENT_VERSION,
        attribution: captureAttributionFromBrowser(),
      }) });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) throw new Error(json?.error || "Не удалось отправить заявку");
      clearOperationId(operation.key);
      setStatus("success");
      setMessage(`Заявка принята. Менеджер ${contactPreference === "message" ? "напишет вам" : "перезвонит вам"} в рабочее время: ${MOSCOW_HOURS}.`);
    } catch (error) {
      setStatus("error");
      setMessage((error as Error)?.message || "Ошибка сети. Повторная отправка не создаст дубль заявки.");
    }
  }

  const title = isFavorites ? "Рассчитать избранные автомобили" : isOffer ? "Оставить заявку на автомобиль" : "Оставить заявку";
  const intro = isFavorites ? "Выберите до 5 автомобилей — рассчитаем стоимость по каждому варианту и свяжемся удобным способом." : isOffer ? "Автомобиль уже выбран. Оставьте контакты — менеджер проверит актуальность и подтвердит точный расчёт." : "Опишите, какой автомобиль нужен. Если его нет на сайте, мы всё равно проверим доступные рынки и подготовим расчёт.";

  return createPortal(
    <div className="ac-lead-dialog-backdrop fixed inset-0 z-[20000] flex items-end justify-center bg-black/70 backdrop-blur-sm lg:items-center lg:p-6" role="dialog" aria-modal="true" aria-labelledby="ac-lead-dialog-title" onMouseDown={(event) => { if (event.target === event.currentTarget && status !== "sending") onClose(); }}>
      <section ref={panelRef} className="ac-lead-dialog ac-hide-scrollbar max-h-[94dvh] w-full overflow-y-auto rounded-t-[28px] bg-[var(--ac-surface)] px-4 pb-[calc(20px+env(safe-area-inset-bottom))] pt-2 text-[var(--ac-text)] lg:max-h-[90vh] lg:max-w-[760px] lg:rounded-[28px] lg:p-7">
        <button type="button" onClick={onClose} disabled={status === "sending"} className="ac-lead-sheet-handle mx-auto mb-3 flex h-6 w-28 items-center justify-center lg:hidden" aria-label="Свернуть форму"><span className="block h-1.5 w-24 rounded-full bg-[var(--ac-muted)]/45" /></button>
        <header className="flex items-start justify-between gap-4">
          {status === "success" ? <div className="flex min-w-0 items-center gap-3"><div className="ac-success-check flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500 text-xl font-black text-white">✓</div><h2 id="ac-lead-dialog-title" className="text-3xl font-black tracking-[-.03em]">Готово!</h2></div> : <div className="min-w-0"><div className="text-xs font-black uppercase tracking-[.16em] text-red-500">АвтоЦена</div><h2 id="ac-lead-dialog-title" className="mt-1 text-2xl font-black tracking-[-.03em] md:text-3xl">{title}</h2><p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-[var(--ac-muted)]">{intro}</p></div>}
          <button type="button" disabled={status === "sending"} onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--ac-surface-2)] text-xl font-bold disabled:opacity-40" aria-label="Закрыть">×</button>
        </header>

        {status === "success" ? <div className="mt-6 rounded-[1.5rem] bg-emerald-500/10 p-5 md:p-6"><h3 className="text-2xl font-black">Спасибо, заявку получили</h3><p className="mt-2 text-sm font-bold leading-6 text-[var(--ac-muted)] md:text-base">{message}</p></div> : <form onSubmit={submit} className="mt-6 grid gap-4">
          {isFavorites ? <FavoriteSelector items={favorites} selectedIds={selectedIds} onToggle={toggleFavorite} /> : null}
          <div className="grid gap-3 md:grid-cols-2"><label className="block min-w-0"><FieldLabel>Ваш город</FieldLabel><input value={form.city} onChange={(event) => setField("city", event.target.value)} autoComplete="address-level2" placeholder="Например, Москва" className="soft-input h-[52px] w-full rounded-2xl bg-[var(--ac-surface-2)] px-4 outline-none" /></label><label className="block min-w-0"><FieldLabel>Имя</FieldLabel><input value={form.name} onChange={(event) => setField("name", event.target.value)} autoComplete="name" placeholder="Как к вам обращаться" className="soft-input h-[52px] w-full rounded-2xl bg-[var(--ac-surface-2)] px-4 outline-none" /></label></div>

          <ContactChoice value={contactPreference} onChange={(value) => { setContactPreference(value); setStatus("idle"); setMessage(""); }} />
          {contactPreference === "message" ? <MessengerFields messenger={messenger} setMessenger={setMessenger} contact={messengerContact} setContact={setMessengerContact} /> : <label className="block min-w-0"><FieldLabel>Телефон</FieldLabel><input type="tel" value={form.phone} onChange={(event) => setField("phone", event.target.value)} autoComplete="tel" inputMode="tel" placeholder="+7 999 000-00-00" className="soft-input h-[52px] w-full rounded-2xl bg-[var(--ac-surface-2)] px-4 outline-none" /></label>}

          {!isFavorites && !isOffer ? <div className="grid gap-3 md:grid-cols-2"><label className="relative block min-w-0"><FieldLabel>Интересующее авто</FieldLabel><input value={form.car} onChange={(event) => setField("car", event.target.value)} onFocus={() => setCarFocused(true)} onBlur={() => window.setTimeout(() => setCarFocused(false), 120)} placeholder="Например, Toyota RAV4" className="soft-input h-[52px] w-full rounded-2xl bg-[var(--ac-surface-2)] px-4 outline-none" autoComplete="off" />{carFocused && suggestions.length ? <div className="absolute left-0 right-0 top-[calc(100%+7px)] z-30 max-h-56 overflow-y-auto rounded-2xl bg-[var(--ac-surface-3)] p-2 shadow-2xl">{suggestions.map((item, index) => { const label = cleanText(item.label) || [item.make, item.model].map(cleanText).filter(Boolean).join(" "); return <button key={item.id || `${label}-${index}`} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setField("car", label); setSuggestions([]); setCarFocused(false); }} className="block min-h-10 w-full rounded-xl px-3 py-2 text-left text-sm font-bold text-[var(--ac-text)] hover:bg-white/[.07]">{label}</button>; })}</div> : null}<span className="mt-1.5 block text-[11px] font-semibold leading-4 text-[var(--ac-muted)]">Можно выбрать подсказку или написать любую марку и модель вручную.</span></label><label className="block min-w-0"><FieldLabel>Бюджет</FieldLabel><div className="relative"><input value={formatBudgetInput(form.budget)} onChange={(event) => setField("budget", event.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="Например, 3 000 000" className="soft-input h-[52px] w-full rounded-2xl bg-[var(--ac-surface-2)] px-4 pr-10 outline-none" /><span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-black text-[var(--ac-muted)]">₽</span></div></label></div> : null}

          {isOffer ? <div className="rounded-2xl bg-[var(--ac-surface-2)] p-4"><div className="text-[11px] font-black uppercase tracking-[.13em] text-[var(--ac-muted)]">Интересующее авто</div><div className="mt-1.5 text-sm font-black text-[var(--ac-text)]">{cleanText(form.car) || "Автомобиль из открытой карточки"}</div></div> : null}

          <label className="block min-w-0"><FieldLabel>Комментарий</FieldLabel><textarea value={form.comment} onChange={(event) => setField("comment", event.target.value)} rows={3} placeholder="Например: нужен полный привод, светлый салон или срок покупки" className="soft-input ac-lead-comment w-full resize-none rounded-2xl bg-[var(--ac-surface-2)] px-4 py-3.5 outline-none" /></label>

          <div className="rounded-2xl bg-[var(--ac-surface-2)] p-4"><label className="flex cursor-pointer items-start gap-3"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="sr-only" /><span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border text-xs font-black ${consent ? "border-red-500 bg-red-500 text-white" : "border-[var(--ac-border)] text-transparent"}`}>✓</span><span className="text-xs font-semibold leading-5 text-[var(--ac-muted)]">Я даю согласие на обработку указанных мной персональных данных для обработки заявки и связи со мной.</span></label><details className="group mt-3 text-xs leading-5 text-[var(--ac-muted)]"><summary className="flex cursor-pointer list-none items-center font-black text-[var(--ac-text)] [&::-webkit-details-marker]:hidden"><span className="mr-2 inline-block transition-transform group-open:rotate-90">▸</span><span>Что происходит с данными</span></summary><p className="mt-2">Используем имя, город, контакт и параметры автомобиля только для обработки этой заявки, подготовки подбора/расчёта и связи по заявке. Рекламные рассылки без отдельного согласия не подключаются. Согласие можно отозвать через контакты сервиса.</p></details></div>

          {status === "error" && message ? <div className="ac-lead-error rounded-2xl bg-red-500/10 p-3 text-sm font-bold leading-5">{message}</div> : null}
          <button type="submit" disabled={status === "sending"} className="avto-button ac-colored-button min-h-14 rounded-2xl px-6 text-base font-black disabled:opacity-55">{status === "sending" ? "Отправляем…" : "Отправить заявку"}</button>
        </form>}
      </section>
      <style jsx global>{`
        @keyframes acLeadSheetUp{from{transform:translateY(28px);opacity:.75}to{transform:translateY(0);opacity:1}}
        @keyframes acLeadModalIn{from{transform:translateY(10px) scale(.985);opacity:.7}to{transform:translateY(0) scale(1);opacity:1}}
        .ac-lead-dialog{animation:acLeadSheetUp .2s ease-out both;overscroll-behavior:contain}.ac-lead-favorites-list{scrollbar-width:thin}.ac-lead-capture-banner{box-shadow:none!important}
        .ac-colored-button,.ac-colored-button *,.ac-lead-capture-banner .avto-button,.ac-lead-dialog .avto-button{color:#fff!important;-webkit-text-fill-color:#fff!important}
        .ac-lead-error{color:#e31b23!important;-webkit-text-fill-color:#e31b23!important}.ac-success-check{color:#fff!important;-webkit-text-fill-color:#fff!important}
        html[data-theme="light"] .ac-lead-capture-banner,html[data-theme="light"] .ac-lead-dialog{color:var(--ac-text)!important}
        html[data-theme="light"] .ac-lead-dialog .ac-lead-comment{color:#5f6878!important;-webkit-text-fill-color:#5f6878!important}
        html[data-theme="light"] .ac-lead-dialog .ac-lead-comment::placeholder{color:#8c96a7!important;opacity:1!important}
        html[data-theme="light"] .ac-lead-sheet-handle span{background:#768093!important}
        body:has(main.ac-home-page) main.ac-home-page>div.mx-auto{padding-bottom:1rem!important}
        body:has(main.ac-home-page) .ac-public-legal-footer{margin-top:1.5rem!important}
        @media(min-width:1024px){.ac-lead-dialog{animation-name:acLeadModalIn}}
      `}</style>
    </div>, document.body,
  );
}

function FavoritesPinnedActions({ onLead }: { onLead: () => void }) {
  return <div data-ac-favorites-bar className="fixed inset-x-0 bottom-0 z-[9000] border-t border-white/10 bg-[var(--ac-surface)] px-3 pb-[calc(10px+env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl md:left-1/2 md:right-auto md:bottom-5 md:w-[min(720px,calc(100vw-40px))] md:-translate-x-1/2 md:rounded-[1.6rem] md:border md:p-3"><div className="mx-auto grid max-w-3xl grid-cols-2 gap-2.5"><button type="button" data-offer-action="messenger" className="ac-colored-button h-14 min-w-0 rounded-[1.25rem] bg-[#00A2E8] px-3 text-[13px] font-black leading-none sm:text-sm">Чат в мессенджере</button><button type="button" onClick={onLead} className="ac-colored-button h-14 min-w-0 rounded-[1.25rem] bg-[#22B14C] px-3 text-[13px] font-black leading-none sm:text-sm">Оставить заявку</button></div></div>;
}

export function PublicLeadCaptureV2() {
  const pathname = usePathname() || "/";
  const [hosts, setHosts] = useState<HostTarget[]>([]);
  const [favorites, setFavorites] = useState<FavoriteLeadItem[]>([]);
  const [request, setRequest] = useState<LeadRequest | null>(null);

  useEffect(() => {
    let cancelled = false; let frame = 0; const created: HTMLElement[] = [];
    const mount = () => {
      if (cancelled) return;
      const targets: Array<{ kind: HostKind; parent: HTMLElement | null }> = [];
      if (pathname === "/") targets.push({ kind: "home", parent: document.querySelector<HTMLElement>("main.ac-home-page > div.mx-auto") });
      if (pathname === "/cars") targets.push({ kind: "catalog", parent: document.querySelector<HTMLElement>("main.ac-catalog-page > section") });
      if (/^\/cars\/brand\/[^/]+\/?$/.test(pathname)) targets.push({ kind: "brand", parent: document.querySelector<HTMLElement>("main.ac-brand-catalog-page > section") });
      if (!targets.length) { setHosts([]); return; }
      if (targets.some((target) => !target.parent)) { frame = window.requestAnimationFrame(mount); return; }
      const next = targets.flatMap(({ kind, parent }) => { if (!parent) return []; const node = document.createElement("div"); node.dataset.acLeadHost = kind; node.style.gridColumn = "1 / -1"; node.style.width = "100%"; parent.appendChild(node); created.push(node); return [{ kind, node }]; });
      setHosts(next);
    };
    mount();
    return () => { cancelled = true; if (frame) window.cancelAnimationFrame(frame); created.forEach((node) => node.remove()); setHosts([]); };
  }, [pathname]);

  useEffect(() => {
    if (pathname !== "/favorites") { setFavorites([]); return; }
    const update = () => setFavorites(readFavorites()); update();
    window.addEventListener("avtocena:favorites-changed", update as EventListener); window.addEventListener("storage", update);
    return () => { window.removeEventListener("avtocena:favorites-changed", update as EventListener); window.removeEventListener("storage", update); };
  }, [pathname]);

  useEffect(() => {
    if (pathname !== "/favorites" || !favorites.length) return;
    const previous = document.body.style.paddingBottom; document.body.style.paddingBottom = "96px";
    return () => { document.body.style.paddingBottom = previous; };
  }, [favorites.length, pathname]);

  useEffect(() => {
    if (!/^\/cars\/brand\/[^/]+\/?$/.test(pathname)) return;
    const click = (event: MouseEvent) => { const target = event.target as HTMLElement | null; const button = target?.closest<HTMLAnchorElement>("main.ac-brand-catalog-page a[href='/#form']"); if (!button) return; event.preventDefault(); event.stopPropagation(); const brand = cleanText(document.querySelector<HTMLElement>("main.ac-brand-catalog-page h1")?.textContent).replace(/\s+под ключ$/i, ""); setRequest({ mode: "generic", source: "brand_lead_action", car: brand }); };
    document.addEventListener("click", click, true); return () => document.removeEventListener("click", click, true);
  }, [pathname]);

  useEffect(() => {
    if (!pathname.startsWith("/cars/offer/")) return;
    const offerId = decodeURIComponent(pathname.slice("/cars/offer/".length).split("/")[0] || ""); if (!offerId) return;
    const click = (event: MouseEvent) => { const target = event.target as HTMLElement | null; const button = target?.closest<HTMLElement>("[data-offer-action='lead']"); if (!button) return; event.preventDefault(); event.stopPropagation(); const heading = document.querySelector<HTMLElement>("main.ac-offer-page h1"); setRequest({ mode: "offer", source: "catalog_offer_request", offerId, car: cleanText(heading?.textContent) }); };
    document.addEventListener("click", click, true); return () => document.removeEventListener("click", click, true);
  }, [pathname]);

  return <>{hosts.map((host) => createPortal(<GenericLeadBanner kind={host.kind} onOpen={() => { const brand = host.kind === "brand" ? cleanText(document.querySelector<HTMLElement>("main.ac-brand-catalog-page h1")?.textContent).replace(/\s+под ключ$/i, "") : ""; setRequest({ mode: "generic", source: `${host.kind}_lead_banner`, car: brand }); }} />, host.node))}{pathname === "/favorites" && favorites.length && !request ? <FavoritesPinnedActions onLead={() => setRequest({ mode: "favorites", source: "favorites_request" })} /> : null}{request ? <LeadDialog key={`${request.mode}:${request.mode === "offer" ? request.offerId : request.source}`} request={request} favorites={favorites} onClose={() => setRequest(null)} /> : null}</>;
}
