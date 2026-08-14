import type { Metadata } from "next";
import Link from "next/link";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { AFFILIATE_LINK_REL, AUTOCREDIT_AFFILIATE_URL } from "@/lib/affiliate-links";

export const metadata: Metadata = {
  title: "Автокредит — АвтоЦена",
  description: "Переход к расчёту автокредита через сайт АвтоЦены.",
};

export default function AutocreditPage() {
  return (
    <main className="ac-page-copy min-h-screen bg-[#1a2029] text-white">
      <PublicHeader />
      <section className="mx-auto flex min-h-[calc(100vh-88px)] w-full max-w-3xl items-center px-4 py-12 md:px-8">
        <div className="w-full rounded-[2rem] bg-[var(--ac-surface)] p-6 text-[var(--ac-text)] md:p-9">
          <div className="text-xs font-black uppercase tracking-[.18em] text-red-500">АвтоЦена</div>
          <h1 className="mt-2 text-3xl font-black tracking-[-.035em] md:text-5xl">Автокредит</h1>
          <p className="mt-4 text-base font-medium leading-7 text-[var(--ac-muted)]">
            Вы перешли из сервиса АвтоЦена. На следующем шаге можно рассчитать условия автокредита на стороне партнёрского сервиса.
          </p>
          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            <a href={AUTOCREDIT_AFFILIATE_URL} target="_blank" rel={AFFILIATE_LINK_REL} className="ac-colored-button flex min-h-14 items-center justify-center rounded-2xl bg-red-500 px-5 text-center text-base font-black text-white">
              Перейти к кредитному калькулятору
            </a>
            <Link href="/" className="flex min-h-14 items-center justify-center rounded-2xl bg-[var(--ac-surface-2)] px-5 text-center text-base font-black text-[var(--ac-text)]">
              Вернуться в АвтоЦену
            </Link>
          </div>
          <p className="mt-5 text-xs font-medium leading-5 text-[var(--ac-muted)]">
            Переход к партнёрскому сервису выполняется только с сайта АвтоЦены. Telegram-бот не размещает партнёрские ссылки напрямую.
          </p>
        </div>
      </section>
    </main>
  );
}
