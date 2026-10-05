"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startRoutePreloader } from "@/components/layout/RoutePreloader";
import { PasswordField } from "@/components/auth/PasswordField";

const AUTH_MESSAGES: Record<string, string> = {
  auth_required: "Сессия завершилась. Войдите снова.",
  telegram_not_allowed: "Для этого аккаунта пока нет доступа. Обратитесь к представителю вашей компании.",
  telegram_invalid: "Не удалось подтвердить данные Telegram. Повторите вход.",
  telegram_expired: "Подтверждение Telegram устарело. Нажмите кнопку входа ещё раз.",
  telegram_not_configured: "Вход через Telegram ещё не активирован в настройках сервиса. Используйте персональный ключ.",
  telegram_deprecated: "Этот способ входа больше не доступен. Используйте кнопку входа через Telegram.",
  telegram_oauth_error: "Не удалось войти через Telegram. Повторите попытку.",
  telegram_state_invalid: "Подтверждение входа устарело. Начните вход заново.",
  telegram_token_exchange_failed: "Не удалось завершить вход через Telegram. Попробуйте войти через @avtocena_bot или используйте персональный ключ.",
  telegram_token_invalid_client: "Не удалось завершить вход через Telegram. Попробуйте войти через @avtocena_bot или используйте персональный ключ.",
  telegram_token_invalid_grant: "Не удалось завершить вход через Telegram. Попробуйте войти через @avtocena_bot или используйте персональный ключ.",
  telegram_token_invalid_request: "Не удалось завершить вход через Telegram. Попробуйте войти через @avtocena_bot или используйте персональный ключ.",
  telegram_token_unauthorized_client: "Не удалось завершить вход через Telegram. Попробуйте войти через @avtocena_bot или используйте персональный ключ.",
  telegram_id_token_invalid: "Не удалось завершить вход через Telegram. Попробуйте войти через @avtocena_bot или используйте персональный ключ.",
};

export function LoginForm({ nextPath, errorCode = "", botUsername = "" }: { nextPath: string; errorCode?: string; botUsername?: string }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(AUTH_MESSAGES[errorCode] || "");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: String(fields.get("username") || ""), accessKey: String(fields.get("accessKey") || "") }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        setError("Не удалось войти. Проверьте логин и пароль.");
        return;
      }
      startRoutePreloader();
      router.push(nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/crm");
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

      <div className="ac-login-details mt-4">
        <form id="staff-login" name="staff-login" action="/api/auth/login" method="post" onSubmit={submit} className="mt-4">
          <div className="grid gap-3">
            <label className="grid gap-2"><span>Логин</span><input name="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Введите логин" autoComplete="section-staff username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required /></label>
            <PasswordField label="Пароль" name="accessKey" autoComplete="section-staff current-password" value={accessKey} onChange={setAccessKey} placeholder="Введите пароль"/>
          </div>
          <button disabled={loading} className="account-primary">{loading ? "Подождите…" : "Войти"}</button>
        </form>
      </div>

    </div>
  );
}
