"use client";
import { useState } from "react";
export function StaffAccess({
  userId,
  canManage = false,
  self = false,
  connected = false,
}: {
  userId: string;
  canManage?: boolean;
  self?: boolean;
  connected?: boolean;
}) {
  const [key, setKey] = useState("");
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function action(kind: string) {
    if (
      kind === "revoke" &&
      !window.confirm(
        "Отключить доступ сотрудника? Его сессии перестанут действовать.",
      )
    )
      return;
    if (
      kind === "issue" &&
      !window.confirm(
        "Выдать новый ключ? Прежний ключ и сессии перестанут действовать.",
      )
    )
      return;
    setBusy(true);
    setMessage("");
    setKey("");
    try {
      const response = await fetch(
        kind === "bind" ? "/api/crm/telegram-bind" : "/api/crm/access",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId, action: kind }),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw Error(result.error || "Не удалось выполнить действие");
      setKey(result.key || "");
      setUrl(result.url || "");
      setMessage(
        kind === "bind"
          ? "Откройте бота и нажмите Start. Ссылка действует 24 часа. До ответа бота не создавайте новую ссылку: она отменяет предыдущую. После ответа обновите страницу CRM."
          : kind === "issue"
            ? "Скопируйте ключ сейчас: повторно он не показывается. Если заменили свой ключ, войдите с ним заново."
            : "Доступ отключён.",
      );
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="glass mt-5 rounded-2xl p-5">
      <h2 className="text-xl font-black">Доступ и Telegram</h2>
      <p className="my-3 text-sm text-[var(--ac-muted)]">
        {connected ? "Telegram подключён." : "Telegram ещё не подключён."}{" "}
        Внутренние заявки доступны владельцам и администраторам. Обычные
        пользователи бота их не видят.
      </p>
      <div className="flex flex-wrap gap-2">
        {canManage && (
          <>
            <button
              disabled={busy}
              onClick={() => action("issue")}
              className="rounded-xl bg-red-500 px-4 py-3 text-sm font-bold text-white"
            >
              Выдать новый ключ
            </button>
            {!self && (
              <button
                disabled={busy}
                onClick={() => action("revoke")}
                className="rounded-xl border px-4 py-3 text-sm font-bold"
              >
                Отозвать доступ
              </button>
            )}
          </>
        )}
        {self && (
          <button
            disabled={busy}
            onClick={() => action("bind")}
            className="rounded-xl bg-[#229ED9] px-4 py-3 text-sm font-bold text-white"
          >
            Подключить мой Telegram
          </button>
        )}
      </div>
      {message && (
        <p role="status" className="mt-3 text-sm">
          {message}
        </p>
      )}
      {key && (
        <div className="mt-3 flex gap-2">
          <input
            readOnly
            aria-label="Новый ключ доступа"
            value={key}
            className="soft-input min-w-0 flex-1 rounded-lg p-3 font-mono"
          />
          <button
            onClick={() =>
              navigator.clipboard
                .writeText(key)
                .catch(() => setMessage("Выделите и скопируйте ключ вручную."))
            }
            className="rounded-lg border px-3"
          >
            Копировать
          </button>
        </div>
      )}
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-block font-bold underline"
        >
          Открыть бота →
        </a>
      )}
    </section>
  );
}
