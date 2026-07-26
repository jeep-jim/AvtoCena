"use client";

import { useEffect, useRef } from "react";

export function TelegramLoginButton({ nextPath }: { nextPath: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "";

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !botUsername) return;
    root.innerHTML = "";
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", botUsername.replace(/^@+/, ""));
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "12");
    script.setAttribute("data-userpic", "true");
    script.setAttribute("data-request-access", "write");
    const callback = new URL("/api/auth/telegram", window.location.origin);
    callback.searchParams.set("next", nextPath || "/crm");
    script.setAttribute("data-auth-url", callback.toString());
    root.appendChild(script);
    return () => { root.innerHTML = ""; };
  }, [botUsername, nextPath]);

  if (!botUsername) {
    return (
      <div className="telegram-login-notice rounded-2xl border px-4 py-3 text-sm font-bold leading-6">
        Telegram-вход подготовлен. Для активации нужно указать имя бота в настройках окружения.
      </div>
    );
  }

  return <div ref={rootRef} className="flex min-h-12 items-center justify-center" aria-label="Войти через Telegram" />;
}
