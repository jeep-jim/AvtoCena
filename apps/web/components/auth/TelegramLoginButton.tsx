"use client";

import { useState } from "react";
import { startRoutePreloader } from "@/components/layout/RoutePreloader";

const POLL_INTERVAL_MS = 1800;
const MAX_POLLS = 170;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function TelegramLoginButton({ nextPath, botUsername }: { nextPath: string; botUsername?: string }) {
  const username = String(botUsername || "").replace(/^@+/, "").trim();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [telegramUrl, setTelegramUrl] = useState("");

  async function signIn() {
    if (!username || loading) return;
    setLoading(true);
    setError("");
    setTelegramUrl("");

    const authWindow = window.open("about:blank", "avtocenaTelegramLogin", "popup,width=520,height=720");
    if (authWindow) {
      try {
        authWindow.document.title = "Telegram — АвтоЦена";
        authWindow.document.body.innerHTML = '<div style="font-family:system-ui;padding:28px">Открываю @avtocena_bot…</div>';
      } catch {}
    }

    try {
      const startResponse = await fetch("/api/auth/telegram/bot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ next: nextPath || "/crm" }),
        cache: "no-store",
      });
      const startResult = await startResponse.json().catch(() => ({}));
      if (!startResponse.ok || !startResult?.ok || !startResult?.telegramUrl) {
        authWindow?.close();
        throw new Error("Не удалось начать вход через Telegram.");
      }

      const url = String(startResult.telegramUrl);
      setTelegramUrl(url);
      if (authWindow && !authWindow.closed) authWindow.location.replace(url);

      for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
        await sleep(POLL_INTERVAL_MS);
        const statusResponse = await fetch("/api/auth/telegram/bot", { cache: "no-store" });
        const status = await statusResponse.json().catch(() => ({}));

        if (status?.status === "approved" && status?.ok) {
          authWindow?.close();
          startRoutePreloader();
          window.location.assign(String(status.next || nextPath || "/crm"));
          return;
        }
        if (status?.status === "denied") {
          authWindow?.close();
          throw new Error("Этот Telegram не добавлен в команду АвтоЦены.");
        }
        if (status?.status === "expired" || status?.status === "missing") {
          authWindow?.close();
          throw new Error("Попытка входа устарела. Нажмите «Войти через Telegram» ещё раз.");
        }
      }

      authWindow?.close();
      throw new Error("Время подтверждения истекло. Повторите вход.");
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : "Не удалось войти через Telegram.");
      setLoading(false);
    }
  }

  if (!username) {
    return (
      <div className="ac-login-telegram-placeholder rounded-2xl bg-amber-400/10 px-4 py-3 text-sm font-bold leading-6 text-amber-100">
        Telegram-вход ещё не активирован. Владелец может подключить @avtocena_bot в CRM → Telegram.
      </div>
    );
  }

  return (
    <div className="grid justify-items-center gap-3">
      <button
        type="button"
        onClick={signIn}
        disabled={loading}
        className="mx-auto inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#229ED9] px-5 py-3 text-base font-bold text-white transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
      >
        <span aria-hidden="true">✈</span>
        <span>{loading ? "Ожидаю кнопку в Telegram…" : "Войти через Telegram"}</span>
      </button>

      {loading ? (
        <div className="max-w-sm text-center text-xs font-bold leading-5 text-white/50">
          В @avtocena_bot нажмите Start. Бот покажет кнопку «✅ Войти в CRM». После её нажатия CRM откроется здесь автоматически.
        </div>
      ) : null}

      {telegramUrl ? (
        <a href={telegramUrl} target="_blank" rel="noreferrer" className="text-xs font-black text-[#65c7f1] underline underline-offset-4">
          Если Telegram не открылся — открыть @avtocena_bot вручную
        </a>
      ) : null}

      {error ? <div className="max-w-sm rounded-xl bg-red-500/12 px-3 py-2 text-center text-xs font-bold leading-5 text-red-100">{error}</div> : null}
    </div>
  );
}
