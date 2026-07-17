"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startRoutePreloader } from "@/components/layout/RoutePreloader";

export function LoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, accessKey })
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
      setError("Ошибка соединения. Проверьте dev-сервер и попробуйте снова.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="glass ac-login-card mx-auto w-full max-w-[440px] rounded-[2rem] p-5 md:p-6">
      <div className="text-sm font-black uppercase tracking-[0.18em] text-red-300">Закрытая зона</div>
      <h1 className="mt-2 text-4xl font-black tracking-[-0.05em] text-white md:text-5xl">Вход</h1>
      <p className="mt-3 text-sm font-bold leading-6 text-white/55">
        Доступ только для сотрудников TopAvto и подключённых партнёров.
      </p>

      <div className="mt-6 grid gap-3">
        <label className="grid gap-2">
          <span className="text-xs font-black uppercase tracking-[0.14em] text-white/38">Telegram username</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="@username"
            className="soft-input ac-login-input rounded-2xl px-4 py-4 text-base font-black"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
          />
        </label>

        <label className="grid gap-2">
          <span className="text-xs font-black uppercase tracking-[0.14em] text-white/38">Ключ доступа</span>
          <input
            value={accessKey}
            onChange={(event) => setAccessKey(event.target.value)}
            placeholder="если требуется"
            type="password"
            className="soft-input ac-login-input rounded-2xl px-4 py-4 text-base font-black"
            autoComplete="off"
          />
        </label>
      </div>

      {error && <div className="ac-login-error mt-4 rounded-2xl bg-red-500/15 px-4 py-3 text-sm font-bold text-red-100">{error}</div>}

      <button disabled={loading} className="avto-button mt-5 w-full rounded-2xl px-5 py-4 font-black disabled:cursor-not-allowed disabled:opacity-60">
        {loading ? "Проверяем доступ..." : "Войти"}
      </button>

      <div className="ac-login-note mt-4 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-xs font-bold leading-5 text-white/45">
        Для входа используйте Telegram username, который добавлен администратором.
      </div>
    </form>
  );
}
