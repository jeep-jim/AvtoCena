"use client";

import { useState } from "react";

type TelegramStatus = {
  configured?: boolean;
  username?: string;
  botId?: string;
  firstName?: string;
  webhookUrl?: string;
  webhookConfiguredAt?: string;
  pendingUpdateCount?: number;
  updatedAt?: string;
};

function dateTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function TelegramSetupForm({ initialStatus }: { initialStatus: TelegramStatus }) {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<TelegramStatus>(initialStatus || {});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function connect(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    setError("");
    const cleanToken = token.trim();
    if (!cleanToken) {
      setError("Вставьте API-токен из BotFather.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/telegram/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: cleanToken, username: "avtocena_bot" }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) {
        const codes: Record<string, string> = {
          token_required: "Токен пустой.",
          wrong_bot: "Этот токен принадлежит не @avtocena_bot.",
          wrong_bot_username: "Разрешён только @avtocena_bot.",
          different_bot_already_configured: "В АвтоЦене уже подключён другой Telegram-бот.",
          forbidden: "Подключать Telegram может только владелец или администратор.",
          telegram_setup_failed: "Telegram не принял токен или не удалось установить webhook. Проверьте токен и повторите.",
        };
        throw new Error(codes[result?.error] || "Не удалось подключить Telegram.");
      }

      setToken("");
      setStatus(result);
      setMessage("Telegram подключён. Токен зашифрован, webhook установлен, бот готов к работе.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Не удалось подключить Telegram.");
    } finally {
      setLoading(false);
    }
  }

  const connected = Boolean(status.configured && status.webhookConfiguredAt);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(340px,.95fr)]">
      <section className="glass rounded-[2rem] p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.16em] text-red-300">Telegram Bot API</div>
            <h2 className="mt-2 text-2xl font-black text-white">Подключить @avtocena_bot</h2>
            <p className="mt-2 max-w-2xl text-sm font-bold leading-6 text-white/50">Вставьте токен из BotFather один раз. АвтоЦена проверит, что это именно наш бот, зашифрует токен в Object Storage и автоматически установит webhook.</p>
          </div>
          <span className={`rounded-full px-3 py-1.5 text-xs font-black ${connected ? "bg-emerald-500/15 text-emerald-200" : "bg-amber-400/15 text-amber-100"}`}>
            {connected ? "● Подключён" : "○ Не подключён"}
          </span>
        </div>

        <form onSubmit={connect} className="mt-6">
          <label className="block">
            <span className="mb-2 block text-xs font-black uppercase tracking-[0.13em] text-white/45">BotFather API token</span>
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="Вставьте токен и нажмите Подключить"
              className="soft-input w-full rounded-2xl px-4 py-4 font-mono text-sm font-bold"
            />
          </label>

          <div className="mt-3 rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-xs font-bold leading-5 text-white/45">
            Токен не сохраняется в браузере и не записывается в GitHub. После успешного подключения поле очистится автоматически.
          </div>

          {error ? <div className="mt-4 rounded-2xl bg-red-500/12 px-4 py-3 text-sm font-bold text-red-100">{error}</div> : null}
          {message ? <div className="mt-4 rounded-2xl bg-emerald-500/12 px-4 py-3 text-sm font-bold text-emerald-100">{message}</div> : null}

          <button
            type="submit"
            disabled={loading}
            className="mt-5 min-h-13 w-full rounded-2xl bg-[#229ED9] px-5 py-4 text-base font-black text-white transition hover:brightness-110 disabled:cursor-wait disabled:opacity-55"
          >
            {loading ? "Проверяю бота и ставлю webhook…" : connected ? "Обновить токен / переподключить" : "Подключить Telegram"}
          </button>
        </form>
      </section>

      <section className="glass rounded-[2rem] p-5 md:p-6">
        <div className="text-xs font-black uppercase tracking-[0.16em] text-white/35">Состояние интеграции</div>
        <div className="mt-4 grid gap-3">
          <div className="rounded-2xl bg-black/15 p-4">
            <div className="text-xs font-black text-white/35">Бот</div>
            <div className="mt-1 text-lg font-black text-white">{status.username ? `@${status.username}` : "@avtocena_bot"}</div>
            {status.firstName ? <div className="mt-1 text-sm font-bold text-white/45">{status.firstName}</div> : null}
          </div>
          <div className="rounded-2xl bg-black/15 p-4">
            <div className="text-xs font-black text-white/35">Webhook</div>
            <div className={`mt-1 text-sm font-black ${connected ? "text-emerald-200" : "text-white/55"}`}>{connected ? "Активен" : "Ожидает подключения"}</div>
            <div className="mt-1 break-all text-xs font-bold text-white/35">{status.webhookUrl || "https://avtocena.com/api/telegram/webhook"}</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-black/15 p-4">
              <div className="text-xs font-black text-white/35">Bot ID</div>
              <div className="mt-1 text-sm font-black text-white/70">{status.botId || "—"}</div>
            </div>
            <div className="rounded-2xl bg-black/15 p-4">
              <div className="text-xs font-black text-white/35">Очередь Telegram</div>
              <div className="mt-1 text-sm font-black text-white/70">{Number.isFinite(Number(status.pendingUpdateCount)) ? Number(status.pendingUpdateCount) : 0}</div>
            </div>
          </div>
          <div className="rounded-2xl bg-black/15 p-4">
            <div className="text-xs font-black text-white/35">Webhook подтверждён</div>
            <div className="mt-1 text-sm font-black text-white/70">{dateTime(status.webhookConfiguredAt)}</div>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-[#229ED9]/25 bg-[#229ED9]/10 p-4 text-sm font-bold leading-6 text-white/65">
          После подключения этот же бот используется для входа сотрудников, привязки Telegram клиента к заявке, отправки расчётов и уведомлений CRM о новых лидах.
        </div>
      </section>
    </div>
  );
}
