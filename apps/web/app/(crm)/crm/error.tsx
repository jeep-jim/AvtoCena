"use client";

import Link from "next/link";

export default function CrmError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="crm-root grid min-h-screen place-items-center bg-[#07080d] px-4 text-white">
      <section className="glass w-full max-w-xl rounded-[2rem] p-6 text-center md:p-8">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-red-500 text-2xl">!</div>
        <h1 className="mt-5 text-3xl font-black tracking-[-.04em]">Раздел временно не открылся</h1>
        <p className="mt-3 text-sm font-bold leading-6 text-white/52">Данные не потеряны. Повторите загрузку или войдите снова, если сессия завершилась.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button type="button" onClick={reset} className="rounded-xl bg-red-500 px-5 py-3 text-sm font-black text-white">Повторить</button>
          <Link href="/login?next=/crm" className="rounded-xl bg-white/10 px-5 py-3 text-sm font-black text-white/75">Войти снова</Link>
          <Link href="/" className="rounded-xl bg-white/10 px-5 py-3 text-sm font-black text-white/75">На главную</Link>
        </div>
      </section>
    </main>
  );
}
