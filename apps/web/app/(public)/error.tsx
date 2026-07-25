"use client";

import { useEffect } from "react";

export default function PublicError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Technical details stay in server and monitoring logs, never in the customer UI.
  }, []);

  return <main className="ac-page-copy min-h-screen bg-[#07080d] px-4 py-24 text-center text-white">
    <section className="mx-auto max-w-xl rounded-[2rem] bg-[var(--ac-surface,#12151d)] p-7 md:p-10">
      <div className="text-xs font-black uppercase tracking-[.18em] text-red-500">АвтоЦена</div>
      <h1 className="mt-3 text-3xl font-black md:text-4xl">Страница временно недоступна</h1>
      <p className="mt-4 font-semibold leading-7 text-white/55">Попробуйте обновить страницу. Ваши выбранные параметры не потеряются.</p>
      <div className="mt-7 grid gap-3 sm:grid-cols-2">
        <button type="button" onClick={reset} className="avto-button min-h-14 rounded-2xl px-5 font-black">Повторить</button>
        <a href="/" className="flex min-h-14 items-center justify-center rounded-2xl bg-white/[.07] px-5 font-black">На главную</a>
      </div>
    </section>
  </main>;
}
