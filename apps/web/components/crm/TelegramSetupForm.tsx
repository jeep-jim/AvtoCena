"use client";
import { useState } from "react";

type TelegramStatus = {
  configured?: boolean; username?: string; firstName?: string; webhookUrl?: string;
  webhookConfiguredAt?: string; pendingUpdateCount?: number; checkedAt?: string;
  webhookMatches?: boolean; telegramLastError?: string; telegramLastErrorAt?: string;
};
const formatDate = (value?: string) => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString("ru-RU", {timeZone: "Europe/Moscow"}) : "Не проверялось";

export function TelegramSetupForm({initialStatus}: {initialStatus: TelegramStatus}) {
  const [status, setStatus] = useState(initialStatus);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [network, setNetwork] = useState<Array<{name: string; ok: boolean; detail: string; durationMs: number}>>([]);
  async function checkNetwork() {
    setBusy(true); setError(""); setNetwork([]);
    try {
      const response = await fetch("/api/telegram/setup?diagnostics=network", {cache: "no-store", signal: AbortSignal.timeout(15000)});
      const result = await response.json();
      if (!response.ok || !result.ok) throw Error("Не удалось проверить сеть сервера.");
      setNetwork(result.checks);
    } catch { setError("Не удалось проверить сеть сервера."); }
    finally { setBusy(false); }
  }
  async function perform(reconnect: boolean) {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/telegram/setup", reconnect ? {
        method: "POST", headers: {"content-type": "application/json"},
        body: JSON.stringify({username: "avtocena_bot", token: token.trim() || undefined}),
      } : {cache: "no-store"});
      const result = await response.json();
      if (!response.ok || !result.ok) throw Error(result.detail || ({
        forbidden: "Нужен вход владельца или администратора.",
        token_required: "API-токен бота ещё не сохранён.",
        token_invalid: "Telegram отклонил токен бота.",
      } as Record<string, string>)[result.error] || "Не удалось проверить Telegram.");
      setStatus(result); setToken("");
      setMessage(reconnect
        ? "Адрес доставки обновлён. Ожидающие сообщения сохранены. Проверьте состояние ещё раз и отправьте /start в боте."
        : "Получено текущее состояние от Telegram.");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="grid gap-5 lg:grid-cols-2">
    <section className="glass rounded-3xl p-6">
      <h2 className="text-2xl font-black">Настройки @avtocena_bot</h2>
      <p className="my-4 text-sm text-[var(--ac-muted)]">Сотрудники входят в CRM по персональным ключам и подключают Telegram в своей карточке. Здесь настраивается доставка сообщений бота.</p>
      <form onSubmit={e => {e.preventDefault(); void perform(true);}} className="grid gap-4">
        <label className="grid gap-2 text-sm font-bold">API-токен бота
          <input type="password" value={token} onChange={e=>setToken(e.target.value)} autoComplete="off" spellCheck={false}
            placeholder={status.configured ? "Токен сохранён — оставьте пустым" : "Токен из BotFather"}
            className="soft-input rounded-xl p-4" />
        </label>
        <p className="text-sm text-[var(--ac-muted)]">Для переподключения используется сохранённый токен. Повторно вводить его не нужно. Ожидающие сообщения не удаляются.</p>
        <button disabled={busy} type="submit" className="rounded-xl bg-[#229ED9] p-4 font-bold text-white disabled:opacity-50">Переподключить бота</button>
        <button disabled={busy} type="button" onClick={()=>void perform(false)} className="rounded-xl border p-4 font-bold disabled:opacity-50">Проверить состояние</button>
        <button disabled={busy} type="button" onClick={()=>void checkNetwork()} className="rounded-xl border p-4 font-bold disabled:opacity-50">Проверить сеть сервера</button>
      </form>
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-500/15 p-4">{error}</p>}
      {message && <p role="status" className="mt-4 rounded-xl bg-emerald-500/15 p-4">{message}</p>}
      {network.length > 0 && <ul className="mt-4 space-y-2 text-sm" aria-label="Диагностика сети">{network.map(item => <li key={item.name}>{item.name}: {item.ok ? "Соединение установлено" : "Ошибка"} — {item.detail} ({item.durationMs} мс)</li>)}</ul>}
    </section>
    <section className="glass rounded-3xl p-6">
      <h2 className="text-xl font-black">Доставка сообщений</h2>
      <dl className="mt-4 grid gap-4 text-sm">
        <div><dt className="text-[var(--ac-muted)]">Токен</dt><dd>{status.configured ? "Сохранён" : "Не настроен"}</dd></div>
        <div><dt className="text-[var(--ac-muted)]">Адрес доставки</dt><dd>{status.checkedAt ? (status.webhookMatches ? "Совпадает с настройками сервера" : "Не совпадает — переподключите бота") : "Нужна живая проверка"}</dd></div>
        <div><dt className="text-[var(--ac-muted)]">Ожидают доставки в Telegram</dt><dd>{status.checkedAt ? status.pendingUpdateCount ?? 0 : "Не проверялось"}</dd></div>
        <div><dt className="text-[var(--ac-muted)]">Последняя проверка, Москва</dt><dd>{formatDate(status.checkedAt)}</dd></div>
        <div><dt className="text-[var(--ac-muted)]">Последняя ошибка Telegram</dt><dd>{status.checkedAt ? status.telegramLastError || "Telegram не сообщает об ошибке" : "Не проверялось"}</dd>{status.telegramLastErrorAt && <dd>{formatDate(status.telegramLastErrorAt)}</dd>}</div>
      </dl>
      <p className="mt-5 text-sm text-[var(--ac-muted)]">Совпадение адреса ещё не подтверждает получение ответа. После переподключения проверьте команду /start и привязку сотрудника. Старая ошибка Telegram может сохраняться после восстановления доставки.</p>
    </section>
  </div>;
}
