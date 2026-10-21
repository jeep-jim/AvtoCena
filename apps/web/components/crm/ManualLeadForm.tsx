"use client";
import {offerRouteId} from "@/lib/catalog/offer-url";
import {PhoneInput} from "@/components/leads/PhoneInput";
import {normalizeRuPhone} from "@/lib/ru-phone";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

function offerIdFromInput(value: string) {
  const clean = value.trim();
  if (!clean) return "";
  const match = clean.match(/\/cars\/offer\/([^/?#]+)/i);
  if (match?.[1]) return offerRouteId(decodeURIComponent(match[1]));
  return clean.replace(/^offer:/i, "").trim();
}

export function ManualLeadForm({ headerAside, headerBefore, offices=[] }: { headerAside?: ReactNode; headerBefore?: ReactNode; offices?:string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState({
    office: offices.length===1?offices[0]:"",
    name: "",
    phone: "+7",
    telegram: "", max: "",
    city: "",
    budgetRub: "",
    offer: "",
    car: "",
    comment: "",
    contactPreference: "call",
  });

  const [existing,setExisting]=useState<{leads:any[];clients:any[]}>({leads:[],clients:[]});
  const [lookupBusy,setLookupBusy]=useState(false);
  useEffect(()=>{const phone=normalizeRuPhone(form.phone);setExisting({leads:[],clients:[]});if(!open||!phone){setLookupBusy(false);return;}const abort=new AbortController();setLookupBusy(true);const timer=setTimeout(async()=>{try{const r=await fetch(`/api/crm/leads/lookup?phone=${encodeURIComponent(phone)}`,{signal:abort.signal,cache:'no-store'});if(!r.ok)throw Error();setExisting(await r.json());}catch(e){if(!abort.signal.aborted)setError('Не удалось проверить клиента. При сохранении проверим повторно.');}finally{if(!abort.signal.aborted)setLookupBusy(false);}},300);return()=>{clearTimeout(timer);abort.abort();};},[form.phone,open]);

  function field(name: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (!form.name.trim()) {
      setError("Укажите имя клиента.");
      return;
    }
    if (!normalizeRuPhone(form.phone) && !form.telegram.trim() && !form.max.trim()) {
      setError("Укажите телефон, Telegram или MAX.");
      return;
    }

    if (form.phone !== "+7" && form.phone && !normalizeRuPhone(form.phone)) {setError("Проверьте телефон: нужно 10 цифр после +7.");return;}
    setLoading(true);
    try {
      const offerId = offerIdFromInput(form.offer);
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "manual_crm",
          office: form.office,
          name: form.name.trim(),
          phone: normalizeRuPhone(form.phone) || undefined,
          telegram: form.telegram.trim() || undefined,
          max: form.max.trim() || undefined,
          city: form.city.trim() || undefined,
          budgetRub: form.budgetRub ? Number(form.budgetRub) : undefined,
          offerId: offerId || undefined,
          selectedOfferIds: offerId ? [offerId] : [],
          car: form.car.trim() || undefined,
          comment: form.comment.trim() || undefined,
          contactPreference: form.contactPreference,
          messenger: form.contactPreference === "message" ? (form.telegram.trim() ? "telegram" : form.max.trim() ? "max" : undefined) : undefined,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) throw new Error(result?.error || "create_failed");

      if(result.leadId){router.push(`/crm/leads?id=${encodeURIComponent(result.leadId)}&layout=list`);router.refresh();}
      setSuccess(result?.duplicate ? "Такая заявка уже была создана." : "Заявка создана.");
      setForm({
        office: offices.length===1?offices[0]:"",
    name: "",
        phone: "+7",
        telegram: "", max: "",
        city: "",
        budgetRub: "",
        offer: "",
        car: "",
        comment: "",
        contactPreference: "call",
      });
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error && submitError.message === "phone_required"
        ? "Для звонка нужен телефон."
        : submitError instanceof Error && submitError.message === "existing_lead_restricted" ? "Клиент уже обращался. Попросите руководителя открыть доступ к существующей заявке." : "Не удалось создать заявку. Проверьте контакты и ссылку на автомобиль.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mb-5">
      <div className="crm-lead-create-toolbar">
      {headerBefore}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        disabled={loading}
        className={`crm-manual-toggle rounded-full px-4 py-2 text-sm font-black transition ${open ? "crm-manual-close" : "bg-red-500 text-white hover:bg-red-400"}`}
      >
        {open ? <><span aria-hidden="true">×</span> Закрыть форму</> : "+ Создать"}
      </button>
      {headerAside}
      </div>

      {open ? (
        <form onSubmit={submit} className="glass mt-4 rounded-[2rem] p-4 md:p-5">
          <div className="mb-4">
            <div className="text-lg font-black text-white">Новая заявка вручную</div>
            <div className="mt-1 text-sm font-bold text-white/45">Можно вставить ссылку на карточку АвтоЦены — машина и расчёт подтянутся с сервера автоматически.</div>
          </div>

          {lookupBusy&&<p role="status" className="mb-3">Проверяем клиента…</p>}
          {!!existing.leads.length&&<div className="mb-4 rounded-xl border border-red-500 p-3"><strong>Клиент уже обращался — продолжите существующую заявку</strong><p>Первое обращение: {new Date(existing.leads[0].createdAt).toLocaleString('ru-RU',{timeZone:'Asia/Novokuznetsk'})} · {existing.leads[0].office||'офис не указан'}</p>{existing.leads.map(l=><a key={l.id} className="mt-2 block underline" href={`/crm/leads?id=${encodeURIComponent(l.id)}&layout=list`}>{l.name||'Клиент'} · {l.car||'Подбор автомобиля'} → Открыть заявку</a>)}</div>}
          {!existing.leads.length&&!!existing.clients.length&&<p className="mb-3">Клиент уже есть в базе. Новая заявка будет связана с его карточкой.</p>}
          <label className="mb-3 block">Офис обращения<input list="crm-lead-offices" value={form.office} onChange={e=>field('office',e.target.value)} maxLength={200} placeholder="Например: Планета или Лесная" className="soft-input mt-1 w-full rounded-xl p-3"/><datalist id="crm-lead-offices">{offices.map(o=><option key={o} value={o}/>)}</datalist></label>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <input value={form.name} onChange={(e) => field("name", e.target.value)} placeholder="Имя клиента *" className="soft-input rounded-xl px-3 py-3 text-sm font-bold" />
            <div className="crm-contact-row md:col-span-2 lg:col-span-3"><PhoneInput value={form.phone} onChange={value => field("phone", value)} />
            <input value={form.telegram} onChange={(e) => field("telegram", e.target.value)} placeholder="Telegram @username" className="soft-input rounded-xl px-3 py-3 text-sm font-bold" /><input value={form.max} onChange={e=>field("max",e.target.value)} placeholder="MAX" aria-label="MAX" className="soft-input rounded-xl px-3 py-3 text-sm font-bold" /></div>
            <input value={form.city} onChange={(e) => field("city", e.target.value)} placeholder="Город" className="soft-input rounded-xl px-3 py-3 text-sm font-bold" />
            <input value={form.budgetRub} onChange={(e) => field("budgetRub", e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" placeholder="Бюджет, ₽" className="soft-input rounded-xl px-3 py-3 text-sm font-bold" />
            <input value={form.offer} onChange={(e) => field("offer", e.target.value)} placeholder="Ссылка / ID машины АвтоЦены" className="soft-input rounded-xl px-3 py-3 text-sm font-bold md:col-span-2" />
            <select value={form.contactPreference} onChange={(e) => field("contactPreference", e.target.value)} className="soft-input rounded-xl px-3 py-3 text-sm font-bold">
              <option value="call">Позвонить</option>
              <option value="message">Написать</option>
            </select>
            <input value={form.car} onChange={(e) => field("car", e.target.value)} placeholder="Автомобиль / пожелание, если без ссылки" className="soft-input rounded-xl px-3 py-3 text-sm font-bold md:col-span-2" />
            <textarea value={form.comment} onChange={(e) => field("comment", e.target.value)} placeholder="Комментарий" rows={3} className="soft-input rounded-xl px-3 py-3 text-sm font-bold md:col-span-2" />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button disabled={loading} className="rounded-xl bg-red-500 px-5 py-3 text-sm font-black text-white disabled:opacity-50">
              {loading ? "Создаём..." : "Создать заявку"}
            </button>
            <button type="button" disabled={loading} onClick={()=>setOpen(false)} className="crm-manual-close rounded-xl px-5 py-3 text-sm font-bold">Отмена</button>
            {error ? <span className="crm-error text-sm font-bold text-red-200">{error}</span> : null}
            {success ? <span className="crm-success text-sm font-bold text-green-200">{success}</span> : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}
