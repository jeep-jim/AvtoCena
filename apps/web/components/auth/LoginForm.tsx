"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startRoutePreloader } from "@/components/layout/RoutePreloader";
import { TelegramLoginButton } from "@/components/auth/TelegramLoginButton";

const AUTH_MESSAGES: Record<string, string> = {
  auth_required: "Сессия завершилась. Войдите снова — несохранённая форма больше не откроет страницу ошибки.",
  telegram_not_allowed: "Этот Telegram пока не добавлен в команду. Попросите владельца или администратора выдать доступ.",
  telegram_invalid: "Не удалось подтвердить данные Telegram. Повторите вход.",
  telegram_expired: "Подтверждение Telegram устарело. Нажмите кнопку входа ещё раз.",
  telegram_not_configured: "Вход через Telegram ещё не активирован в настройках сервиса. Используйте резервный ключ.",
};

export function LoginForm({ nextPath, errorCode = "" }: { nextPath: string; errorCode?: string }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(AUTH_MESSAGES[errorCode] || "");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, accessKey }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        setError("Доступ не подтверждён. Проверьте Telegram username или ключ доступа.");
        return;
      }
      startRoutePreloader();
      router.push(nextPath || "/crm");
      router.refresh();
    } catch {
      setError("Ошибка соединения. Попробуйте снова.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="glass ac-login-card mx-auto w-full max-w-[460px] rounded-[2rem] p-5 md:p-6">
      {error ? <div className="ac-login-error mb-4 rounded-2xl bg-red-500/15 px-4 py-3 text-sm font-bold leading-6 text-red-100">{error}</div> : null}

      <div className="ac-login-telegram-shell rounded-2xl bg-white/[0.045] p-4">
        <TelegramLoginButton nextPath={nextPath} />
      </div>

      <details className="ac-login-details mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <summary className="ac-login-details-summary cursor-pointer list-none text-sm font-black text-white/55 [&::-webkit-details-marker]:hidden">Резервный вход по ключу доступа</summary>
        <form onSubmit={submit} className="mt-4">
          <div className="grid gap-3">
            <label className="grid gap-2"><span className="ac-login-field-label text-xs font-black uppercase tracking-[0.14em] text-white/38">Telegram username</span><input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="@username" className="soft-input ac-login-input rounded-2xl px-4 py-4 text-base font-black" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} /></label>
            <label className="grid gap-2"><span className="ac-login-field-label text-xs font-black uppercase tracking-[0.14em] text-white/38">Ключ доступа</span><input value={accessKey} onChange={(event) => setAccessKey(event.target.value)} placeholder="резервный ключ" type="password" className="soft-input ac-login-input rounded-2xl px-4 py-4 text-base font-black" autoComplete="current-password" /></label>
          </div>
          <button disabled={loading} className="avto-button ac-login-submit mt-5 w-full rounded-2xl px-5 py-4 font-black disabled:cursor-not-allowed disabled:opacity-60">{loading ? "Проверяем доступ..." : "Войти резервным способом"}</button>
        </form>
      </details>

      <div className="ac-login-note mt-4 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-xs font-bold leading-5 text-white/45">Войти сможет только пользователь, которого владелец или администратор добавил в раздел «Команда и права».</div>
    </div>
  );
}
