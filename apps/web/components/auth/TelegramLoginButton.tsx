"use client";

import { useEffect, useState } from "react";
import { startRoutePreloader } from "@/components/layout/RoutePreloader";

type TelegramLoginResult = {
  id_token?: string;
  error?: string;
};

type TelegramLoginApi = {
  auth: (
    options: { client_id: number; scope?: string[]; lang?: string; nonce?: string },
    callback: (result: TelegramLoginResult) => void,
  ) => void;
};

declare global {
  interface Window {
    Telegram?: {
      Login?: TelegramLoginApi;
    };
  }
}

const TELEGRAM_LOGIN_SDK = "https://oauth.telegram.org/js/telegram-login.js?3";

export function TelegramLoginButton({ nextPath, botId }: { nextPath: string; botId?: string }) {
  const clientId = Number(botId || 0);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!Number.isFinite(clientId) || clientId <= 0) return;
    if (window.Telegram?.Login?.auth) {
      setReady(true);
      return;
    }

    let script = document.querySelector<HTMLScriptElement>(`script[src^="https://oauth.telegram.org/js/telegram-login.js"]`);
    let created = false;
    if (!script) {
      script = document.createElement("script");
      script.src = TELEGRAM_LOGIN_SDK;
      script.async = true;
      script.dataset.avtocenaTelegramLogin = "1";
      document.head.appendChild(script);
      created = true;
    }

    const onLoad = () => {
      if (window.Telegram?.Login?.auth) {
        setReady(true);
        setError("");
      } else {
        setError("Telegram Login загрузился без API авторизации. Обновите страницу и повторите.");
      }
    };
    const onError = () => setError("Не удалось загрузить Telegram Login. Проверьте соединение и повторите.");

    script.addEventListener("load", onLoad);
    script.addEventListener("error", onError);
    if (window.Telegram?.Login?.auth) onLoad();

    return () => {
      script?.removeEventListener("load", onLoad);
      script?.removeEventListener("error", onError);
      if (created && !script?.isConnected) setReady(false);
    };
  }, [clientId]);

  async function signIn() {
    setError("");
    if (!Number.isFinite(clientId) || clientId <= 0) {
      setError("Telegram Login ещё не настроен.");
      return;
    }
    if (!window.Telegram?.Login?.auth || !ready) {
      setError("Telegram Login ещё загружается. Повторите через секунду.");
      return;
    }

    setLoading(true);
    try {
      window.Telegram.Login.auth(
        {
          client_id: clientId,
          scope: ["profile", "write"],
          lang: "ru",
        },
        async (telegramResult) => {
          try {
            if (telegramResult?.error || !telegramResult?.id_token) {
              setError(telegramResult?.error || "Telegram не вернул подтверждение входа.");
              return;
            }

            const response = await fetch("/api/auth/telegram", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                idToken: telegramResult.id_token,
                next: nextPath || "/crm",
              }),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result?.ok) {
              const messages: Record<string, string> = {
                telegram_not_configured: "Telegram-вход ещё не настроен в АвтоЦене.",
                telegram_invalid: "Telegram не подтвердил подлинность входа. Повторите попытку.",
                telegram_expired: "Подтверждение Telegram устарело. Нажмите вход ещё раз.",
                telegram_not_allowed: "Этот Telegram не добавлен в команду АвтоЦены.",
              };
              setError(messages[result?.error] || "Не удалось войти через Telegram.");
              return;
            }

            startRoutePreloader();
            window.location.assign(result.next || nextPath || "/crm");
          } catch {
            setError("Не удалось завершить Telegram-вход. Повторите попытку.");
          } finally {
            setLoading(false);
          }
        },
      );
    } catch {
      setLoading(false);
      setError("Не удалось открыть Telegram Login.");
    }
  }

  if (!Number.isFinite(clientId) || clientId <= 0) {
    return (
      <div className="ac-login-telegram-placeholder rounded-2xl bg-amber-400/10 px-4 py-3 text-sm font-bold leading-6 text-amber-100">
        Telegram-вход готов технически, но у подключённого бота ещё нет Client ID.
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={signIn}
        disabled={!ready || loading}
        className="mx-auto inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#229ED9] px-5 py-3 text-base font-bold text-white transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
      >
        <span aria-hidden="true">✈</span>
        <span>{loading ? "Подтверждаем вход…" : ready ? "Войти через Telegram" : "Загружаем Telegram…"}</span>
      </button>
      {error ? <div className="rounded-xl bg-red-500/12 px-3 py-2 text-center text-xs font-bold leading-5 text-red-100">{error}</div> : null}
    </div>
  );
}
