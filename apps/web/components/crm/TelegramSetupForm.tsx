"use client";

import { useState } from "react";

type TelegramStatus = {
  configured?: boolean;
  oidcConfigured?: boolean;
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
  const [clientSecret, setClientSecret] = useState("");
  const [status, setStatus] = useState<TelegramStatus>(initialStatus || {});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const connected = Boolean(status.configured && status.webhookConfiguredAt);
  const oidcReady = Boolean(status.oidcConfigured && status.botId);

  async function connect(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    setError("");
    const cleanToken = token.trim();
    const cleanClientSecret = clientSecret.trim();

    if (!connected && !cleanToken) {
      setError("Вставьте API-токен бота из BotFather.");
      return;
    }
    if (connected && !cleanToken && !cleanClientSecret) {
      setError("Вставьте Client Secret для Telegram Login или новый API-токен бота.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/telegram/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: cleanToken || undefined,
          clientSecret: cleanClientSecret || undefined,
          username: "avtocena_bot",
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) {
        const codes: Record<string, string> = {
          token_required: "API-токен бота ещё не сохранён.",
          token_invalid: "Telegram отклонил сам токен: он недействителен или был отозван в BotFather.",
          client_secret_invalid: "Client Secret выглядит некорректно.",
          telegram_getme_failed: "Не удалось проверить токен через Telegram API.",
          wrong_bot: "Токен рабочий, но принадлежит не @avtocena_bot.",
          wrong_bot_username: "Разрешён только @avtocena_bot.",
          different_bot_already_configured: "В АвтоЦене уже подключён другой Telegram-бот.",
          telegram_storage_failed: "Telegram принят, но АвтоЦена не смогла сохранить защищённую конфигурацию.",
          telegram_webhook_failed: "Токен Telegram принят, но Telegram отклонил установку webhook.",
          telegram_webhook_status_failed: "Webhook отправлен в Telegram, но не удалось проверить его состояние.",
          telegram_webhook_mismatch: "Telegram не подтвердил ожидаемый адрес webhook.",
          forbidden: "Подключать Telegram может только владелец или администратор.",
        };
        const base = codes[result?.error] || "Не удалось сохранить Telegram-настройки.";
        const stage = result?.stage ? ` Этап: ${result.stage}.` : "";
        const detail = result?.detail ? ` Telegram: ${String(result.detail)}` : "";
        throw new Error(`${base}${stage}${detail}`);
      }

      setToken("");
      setClientSecret("");
      setStatus(result);
      setMessage(result.oidcConfigured
        ? "Telegram полностью готов: Bot API, webhook и вход сотрудников через OIDC настроены."
        : "Bot API подключён. Для входа сотрудников добавьте Client Secret из BotFather → Login Widget.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Не удалось сохранить Telegram-настройки.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(340px,.95fr)]">
      <section className="glass rounded-[2rem] p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.16em] text-red-300">Telegram Bot API + Login</div>
            <h2 className="mt-2 text-2xl font-black text-white">Настройки @avtocena_bot</h2>
            <p className="mt-2 max-w-2xl text-sm font-bold leading-6 text-white/50">
              API-токен нужен боту и webhook. Client Secret нужен только для надёжного входа сотрудников через официальный Telegram OIDC. Оба секрета хранятся зашифрованно в Object Storage.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className={`rounded-full px-3 py-1.5 text-xs font-black ${connected ? "bg-emerald-500/15 text-emerald-200" : "bg-amber-400/15 text-amber-100"}`}>
              {connected ? "● Бот подключён" : "○ Бот не подключён"}
            </span>
            <span className={`rounded-full px-3 py-1.5 text-xs font-black ${oidcReady ? "bg-emerald-500/15 text-emerald-200" : "bg-amber-400/15 text-amber-100"}`}>
              {oidcReady ? "● Telegram Login готов" : "○ Нужен Client Secret"}
            </span>
          </div>
        </div>

        <form onSubmit={connect} className="mt-6 grid gap-4">
          <label className="block">
            <span className="mb-2 block text-xs font-black uppercase tracking-[0.13em] text-white/45">BotFather API token</span>
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder={connected ? "Уже сохранён — оставьте пустым" : "Вставьте API token бота"}
              className="soft-input w-full rounded-2xl px-4 py-4 font-mono text-sm font-bold"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-black uppercase tracking-[0.13em] text-white/45">Telegram Login Client Secret</span>
            <input
              type="password"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder={oidcReady ? "Уже сохранён — оставьте пустым" : "BotFather → Login Widget → Client Secret"}
              className="soft-input w-full rounded-2xl px-4 py-4 font-mono text-sm font-bold"
            />
            <div className="mt-2 text-xs font-bold leading-5 text-white/40">
              Client ID брать не нужно — АвтоЦена уже знает его из Bot ID. Нужен только Client Secret с экрана Login Widget.
            </div>
          </label>

          <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-xs font-bold leading-5 text-white/45">
            Значения не сохраняются в браузере и не записываются в GitHub. После успешного сохранения оба поля очищаются автоматически.
          </div>

          {error ? <div className="rounded-2xl bg-red-500/12 px-4 py-3 text-sm font-bold leading-6 text-red-100">{error}</div> : null}
          {message ? <div className="rounded-2xl bg-emerald-500/12 px-4 py-3 text-sm font-bold leading-6 text-emerald-100">{message}</div> : null}

          <button
            type="submit"
            disabled={loading}
            className="min-h-13 w-full rounded-2xl bg-[#229ED9] px-5 py-4 text-base font-black text-white transition hover:brightness-110 disabled:cursor-wait disabled:opacity-55"
          >
            {loading ? "Проверяю и сохраняю настройки…" : oidcReady ? "Обновить настройки Telegram" : "Сохранить и включить Telegram Login"}
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
            <div className="text-xs font-black text-white/35">Вход сотрудников</div>
            <div className={`mt-1 text-sm font-black ${oidcReady ? "text-emerald-200" : "text-amber-100"}`}>
              {oidcReady ? "OIDC + PKCE активен" : "Ожидает Client Secret"}
            </div>
            <div className="mt-1 text-xs font-bold text-white/35">Callback: https://avtocena.com/api/auth/telegram</div>
          </div>
          <div className="rounded-2xl bg-black/15 p-4">
            <div className="text-xs font-black text-white/35">Webhook</div>
            <div className={`mt-1 text-sm font-black ${connected ? "text-emerald-200" : "text-white/55"}`}>{connected ? "Активен" : "Ожидает подключения"}</div>
            <div className="mt-1 break-all text-xs font-bold text-white/35">{status.webhookUrl || "https://avtocena.com/api/telegram/webhook"}</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-black/15 p-4">
              <div className="text-xs font-black text-white/35">Client / Bot ID</div>
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
          После настройки один бот обслуживает вход сотрудников, привязку Telegram клиента к заявке, отправку расчётов и уведомления CRM о новых лидах.
        </div>
      </section>
    </div>
  );
}
