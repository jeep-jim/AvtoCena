import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/components/auth/LoginForm";
import { PublicHeader } from "@/components/layout/PublicHeader";

export const metadata: Metadata = {
  title: "Вход — АвтоЦена",
  robots: { index: false, follow: false },
};

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function DealerIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 14.5V11.8L6.5 7.5H17.5L20 11.8V17H18.2M5.8 17H4V14.5H20V17H18.2M8 17H16" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7.3" cy="17" r="2" stroke="currentColor" strokeWidth="1.9" />
      <circle cx="16.7" cy="17" r="2" stroke="currentColor" strokeWidth="1.9" />
      <path d="M6.6 11.5H17.4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

export default async function LoginPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = (await searchParams) ?? {};
  const nextPath = firstParam(params.next) || "/crm";
  const errorCode = firstParam(params.error) || "";

  return (
    <main className="ac-login-page ac-page-copy min-h-screen text-white">
      <PublicHeader />

      <section className="mx-auto grid min-h-[calc(100vh-64px)] max-w-7xl place-items-center px-4 py-8 md:px-8 md:py-10">
        <div className="w-full max-w-[460px]">
          <LoginForm nextPath={nextPath} errorCode={errorCode} />
          <Link href="/dealers" className="ac-login-dealers mt-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white/[.07] px-4 text-sm font-black text-white transition hover:bg-white/[.11]">
            <DealerIcon />
            <span>АвтоДилерам</span>
          </Link>
        </div>
      </section>

      <style>{`
        .ac-login-page::after{display:none!important}
        .ac-login-dealers{box-shadow:none!important}

        html[data-theme="light"] .ac-login-page{color:#171b24!important}
        html[data-theme="light"] .ac-login-card{background:#fff!important;background-image:none!important;border:1px solid rgba(30,36,48,.11)!important;color:#171b24!important}
        html[data-theme="light"] .ac-login-eyebrow{color:#c91f2d!important;-webkit-text-fill-color:#c91f2d!important}
        html[data-theme="light"] .ac-login-title{color:#171b24!important;-webkit-text-fill-color:#171b24!important}
        html[data-theme="light"] .ac-login-description{color:#505a6a!important;-webkit-text-fill-color:#505a6a!important}
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
        html[data-theme="light"] .ac-login-dealers{background:#e7eaf0!important;color:#171b24!important;-webkit-text-fill-color:#171b24!important}
        html[data-theme="light"] .ac-login-dealers:hover{background:#dfe3ea!important}
      `}</style>
    </main>
  );
}
