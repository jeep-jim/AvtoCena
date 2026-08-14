"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

function offerIdFromInput(value: string) {
  const clean = value.trim();
  if (!clean) return "";
  const match = clean.match(/\/cars\/offer\/([^/?#]+)/i);
  if (match?.[1]) return decodeURIComponent(match[1]);
  return clean.replace(/^offer:/i, "").trim();
}

export function ManualLeadForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState({
    name: "",
    phone: "",
    telegram: "",
    city: "",
    budgetRub: "",
    offer: "",
    car: "",
    comment: "",
    contactPreference: "call",
  });

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
    if (!form.phone.trim() && !form.telegram.trim()) {
      setError("Укажите телефон или Telegram.");
      return;
    }

    setLoading(true);
    try {
      const offerId = offerIdFromInput(form.offer);
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "manual_crm",
          name: form.name.trim(),
          phone: form.phone.trim() || undefined,
          telegram: form.telegram.trim() || undefined,
          city: form.city.trim() || undefined,
          budgetRub: form.budgetRub ? Number(form.budgetRub) : undefined,
          offerId: offerId || undefined,
          selectedOfferIds: offerId ? [offerId] : [],
          car: form.car.trim() || undefined,
          comment: form.comment.trim() || undefined,
          contactPreference: form.contactPreference,
          messenger: form.contactPreference === "message" && form.telegram.trim() ? "telegram" : undefined,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) throw new Error(result?.error || "create_failed");

      setSuccess(result?.duplicate ? "Такая заявка уже была создана." : "Заявка создана.");
      setForm({
        name: "",
        phone: "",
        telegram: "",
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
        : "Не удалось создать заявку. Проверьте контакты и ссылку на автомобиль.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mb-5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="rounded-full bg-red-500 px-4 py-2 text-sm font-black text-white transition hover:bg-red-400"
      >
        {open ? "Закрыть форму" : "+ Создать заявку"}
      </button>

      {open ? (
        <form onSubmit={submit} className="glass mt-4 rounded-[2rem] p-4 md:p-5">
          <div className="mb-4">
            <div className="text-lg font-black text-white">Новая заявка вручную</div>
            <div className="mt-1 text-sm font-bold text-white/45">Можно вставить ссылку на карточку АвтоЦены — машина и расчёт подтянутся с сервера автоматически.</div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <input value={form.name} onChange={(e) => field("name", e.target.value)} placeholder="Имя клиента *" className="soft-input rounded-xl px-3 py-3 text-sm font-bold" />
            <input value={form.phone} onChange={(e) => field("phone", e.target.value)} placeholder="Телефон" className="soft-input rounded-xl px-3 py-3 text-sm font-bold" />
            <input value={form.telegram} onChange={(e) => field("telegram", e.target.value)} placeholder="Telegram @username" className="soft-input rounded-xl px-3 py-3 text-sm font-bold" />
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
            {error ? <span className="text-sm font-bold text-red-200">{error}</span> : null}
            {success ? <span className="text-sm font-bold text-green-200">{success}</span> : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}
