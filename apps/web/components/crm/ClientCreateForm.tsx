"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ClientCreateForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    fio: "",
    phone: "",
    telegram: "",
    city: "",
    car: "",
    budgetRub: "",
    comment: ""
  });

  function update(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSent(false);

    if (!form.fio.trim() && !form.phone.trim() && !form.telegram.trim()) {
      setError("Укажите ФИО, телефон или Telegram клиента.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/crm/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, operationId: crypto.randomUUID() })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error === "storage_write_failed" ? "storage_write_failed" : "client_create_error");
      }

      setSent(true);
      setForm({ fio: "", phone: "", telegram: "", city: "", car: "", budgetRub: "", comment: "" });
      router.refresh();
    } catch (error) {
      setError(error instanceof Error && error.message === "storage_write_failed" ? "Не получилось сохранить клиента в production-хранилище. Запись не подтверждена, попробуйте ещё раз или обратитесь к администратору." : "Не получилось добавить клиента. Проверьте авторизацию и доступность CRM.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="glass rounded-[2rem] p-5 md:p-6">
      <div className="text-sm font-black uppercase tracking-[0.16em] text-red-300">Новый клиент</div>
      <h2 className="mt-2 text-3xl font-black tracking-[-0.04em]">Добавить в CRM</h2>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <input value={form.fio} onChange={(event) => update("fio", event.target.value)} placeholder="ФИО клиента" className="soft-input rounded-2xl px-4 py-4 text-sm font-bold md:col-span-2" />
        <input value={form.phone} onChange={(event) => update("phone", event.target.value)} placeholder="Телефон" className="soft-input rounded-2xl px-4 py-4 text-sm font-bold" />
        <input value={form.telegram} onChange={(event) => update("telegram", event.target.value)} placeholder="Telegram" className="soft-input rounded-2xl px-4 py-4 text-sm font-bold" />
        <input value={form.city} onChange={(event) => update("city", event.target.value)} placeholder="Город" className="soft-input rounded-2xl px-4 py-4 text-sm font-bold" />
        <input value={form.budgetRub} onChange={(event) => update("budgetRub", event.target.value)} placeholder="Бюджет, ₽" inputMode="numeric" className="soft-input rounded-2xl px-4 py-4 text-sm font-bold" />
        <input value={form.car} onChange={(event) => update("car", event.target.value)} placeholder="Интересующий автомобиль" className="soft-input rounded-2xl px-4 py-4 text-sm font-bold md:col-span-2" />
        <textarea value={form.comment} onChange={(event) => update("comment", event.target.value)} placeholder="Комментарий" rows={4} className="soft-input resize-none rounded-2xl px-4 py-4 text-sm font-bold md:col-span-2" />
      </div>

      {error && <div className="mt-4 rounded-2xl bg-red-500/15 px-4 py-3 text-sm font-bold text-red-100">{error}</div>}
      {sent && <div className="mt-4 rounded-2xl bg-green-500/15 px-4 py-3 text-sm font-bold text-green-100">Клиент добавлен. Заявка создана и назначена на вас.</div>}

      <button disabled={loading} className="avto-button mt-5 w-full rounded-2xl px-5 py-4 font-black disabled:cursor-not-allowed disabled:opacity-60">
        {loading ? "Сохраняем..." : "Добавить клиента"}
      </button>
    </form>
  );
}
