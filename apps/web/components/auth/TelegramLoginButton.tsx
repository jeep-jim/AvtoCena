"use client";

import { useEffect, useRef } from "react";

export function TelegramLoginButton({ nextPath, botUsername }: { nextPath: string; botUsername?: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const normalizedBotUsername = String(botUsername || "").trim().replace(/^@+/, "");

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !normalizedBotUsername) return;
    root.innerHTML = "";
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", normalizedBotUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "12");
    script.setAttribute("data-userpic", "true");
    script.setAttribute("data-request-access", "write");
    const callback = new URL("/api/auth/telegram", window.location.origin);
    callback.searchParams.set("next", nextPath || "/crm");
    script.setAttribute("data-auth-url", callback.toString());
    root.appendChild(script);
    return () => { root.innerHTML = ""; };
  }, [normalizedBotUsername, nextPath]);

  if (!normalizedBotUsername) {
    return (
      <div className="ac-login-telegram-placeholder rounded-2xl bg-amber-400/10 px-4 py-3 text-sm font-bold leading-6 text-amber-100">
        Telegram-вход готов технически. Для активации укажите TELEGRAM_BOT_USERNAME и TELEGRAM_BOT_TOKEN в окружении production.
      </div>
    );
  }

  return <div ref={rootRef} className="flex min-h-12 items-center justify-center" aria-label="Войти через Telegram" />;
}
