import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/components/auth/LoginForm";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { getTelegramPublicConfig } from "@/lib/telegram-config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Вход — АвтоЦена",
  robots: { index: false, follow: false },
};

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = (await searchParams) ?? {};
  const nextPath = firstParam(params.next) || "/crm";
  const errorCode = firstParam(params.error) || "";
  const telegramConfig = await getTelegramPublicConfig();
  const botUsername = telegramConfig.configured ? telegramConfig.username : "";

  return (
    <main className="ac-login-page ac-page-copy min-h-screen text-white">
      <PublicHeader backHref="/" backLabel="Назад" />

      <section className="mx-auto grid min-h-[calc(100vh-64px)] max-w-7xl place-items-center px-4 py-8 md:px-8 md:py-10">
        <div className="w-full max-w-[460px]">
          <Link href="/dealers" className="ac-login-dealers mb-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#e31b23] px-4 text-sm font-black text-white transition hover:bg-[#c91820]">
            <span aria-hidden="true" className="text-base leading-none">🚗</span>
            <span>АвтоДилерам</span>
          </Link>
          <LoginForm nextPath={nextPath} errorCode={errorCode} botUsername={botUsername} />
        </div>
      </section>

      <style>{`
        .ac-login-page::after{display:none!important}
        .ac-login-dealers,.ac-login-dealers:hover,.ac-login-dealers:focus-visible{background:#e31b23!important;background-color:#e31b23!important;color:#fff!important;-webkit-text-fill-color:#fff!important;box-shadow:none!important}
        .ac-login-dealers:hover{background:#c91820!important;background-color:#c91820!important}
        .ac-login-dealers *{color:#fff!important;-webkit-text-fill-color:#fff!important}

        html[data-theme="light"] .ac-login-page{color:#171b24!important}
        html[data-theme="light"] .ac-login-card{background:#fff!important;background-image:none!important;border:1px solid rgba(30,36,48,.11)!important;color:#171b24!important}
        html[data-theme="light"] .ac-login-telegram-shell{background:#eef1f5!important;border:1px solid rgba(30,36,48,.08)!important}
        html[data-theme="light"] .ac-login-telegram-placeholder{background:#fff2bf!important;border:1px solid #e5c65a!important;color:#6f5200!important;-webkit-text-fill-color:#6f5200!important}
        html[data-theme="light"] .ac-login-details{background:#f4f6f9!important;border-color:rgba(30,36,48,.12)!important}
        html[data-theme="light"] .ac-login-details-summary{color:#394251!important;-webkit-text-fill-color:#394251!important}
        html[data-theme="light"] .ac-login-field-label{color:#667183!important;-webkit-text-fill-color:#667183!important}
        html[data-theme="light"] .ac-login-input{background:#e9edf3!important;border-color:rgba(30,36,48,.14)!important;color:#171b24!important;-webkit-text-fill-color:#171b24!important}
        html[data-theme="light"] .ac-login-input::placeholder{color:#778191!important;-webkit-text-fill-color:#778191!important;opacity:1!important}
        html[data-theme="light"] .ac-login-note{background:#edf0f5!important;border-color:rgba(30,36,48,.11)!important;color:#4e5869!important;-webkit-text-fill-color:#4e5869!important}
        html[data-theme="light"] .ac-login-error{background:#f9e3e6!important;color:#941c28!important;-webkit-text-fill-color:#941c28!important}
        html[data-theme="light"] .ac-login-submit,html[data-theme="light"] .ac-login-submit *{color:#fff!important;-webkit-text-fill-color:#fff!important}
      `}</style>
    </main>
  );
}
