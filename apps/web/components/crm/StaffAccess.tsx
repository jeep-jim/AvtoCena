"use client";
import { useState } from "react";
export function StaffAccess({
  userId,
  canManage = false,
  self = false,
}: {
  userId: string;
  canManage?: boolean;
  self?: boolean;
  connected?: boolean;
}) {
  const [key, setKey] = useState("");
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
        "/api/crm/access",
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
      setMessage(
        kind === "issue"
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
      <h2 className="text-xl font-black">Доступ в CRM</h2>
      <p className="my-3 text-sm text-[var(--ac-muted)]">
        Вход по логину и персональному ключу. Заявки направляются в закрытую группу команды; подключать личный Telegram не требуется.
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
    </section>
  );
}
