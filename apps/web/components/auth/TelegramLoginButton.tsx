"use client";

import { useState } from "react";
import { startRoutePreloader } from "@/components/layout/RoutePreloader";

export function TelegramLoginButton({ nextPath, botId }: { nextPath: string; botId?: string }) {
  const clientId = Number(botId || 0);
  const [loading, setLoading] = useState(false);

  function signIn() {
    if (!Number.isFinite(clientId) || clientId <= 0 || loading) return;
    setLoading(true);
    startRoutePreloader();
    const target = new URL("/api/auth/telegram/start", window.location.origin);
    target.searchParams.set("next", nextPath || "/crm");
    window.location.assign(target.toString());
  }

  if (!Number.isFinite(clientId) || clientId <= 0) {
    return (
      <div className="ac-login-telegram-placeholder rounded-2xl bg-amber-400/10 px-4 py-3 text-sm font-bold leading-6 text-amber-100">
        Telegram-вход ещё не активирован. Владелец может добавить Client Secret в CRM → Telegram.
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={signIn}
      disabled={loading}
      className="mx-auto inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#229ED9] px-5 py-3 text-base font-bold text-white transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
    >
      <span aria-hidden="true">✈</span>
      <span>{loading ? "Открываю Telegram…" : "Войти через Telegram"}</span>
    </button>
  );
}
