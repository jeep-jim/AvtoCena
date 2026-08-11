import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/components/auth/LoginForm";
import { BrandMark } from "@/components/brand/BrandMark";

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
      <header className="ac-login-header border-b border-white/[.07]">
        <div className="mx-auto flex h-16 w-full max-w-[1500px] items-center justify-between gap-3 px-4 md:px-8">
          <Link href="/" className="ac-login-brand flex min-w-0 items-center gap-2.5">
            <BrandMark className="h-9 w-9 shrink-0 md:h-10 md:w-10" />
            <div className="min-w-0">
              <div className="ac-login-brand-title text-[18px] font-black leading-none md:text-[22px]"><span className="text-red-500">Авто</span><span className="text-white">Цена</span></div>
              <div className="ac-login-brand-subtitle text-[11px] font-bold leading-none text-white/45">подбор · расчёт</div>
            </div>
          </Link>

          <div className="ac-login-header-actions flex items-center gap-2">
            <Link href="/dealers" className="ac-login-dealers inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[.07] px-3 text-sm font-black text-white transition hover:bg-white/[.11] md:h-11 md:px-4">
              <DealerIcon />
              <span>АвтоДилерам</span>
            </Link>
            <Link href="/" className="ac-login-home inline-flex h-10 items-center rounded-xl bg-white/[.07] px-3 text-sm font-black text-white/75 transition hover:bg-white/[.11] hover:text-white md:h-11 md:px-4">На главную</Link>
          </div>
        </div>
      </header>

      <section className="mx-auto grid min-h-[calc(100vh-64px)] max-w-7xl place-items-center px-4 py-8 md:px-8 md:py-10">
        <LoginForm nextPath={nextPath} errorCode={errorCode} />
      </section>

      <style>{`
        .ac-login-page::after{display:none!important}
        .ac-login-header{background:rgba(15,23,42,.72);-webkit-backdrop-filter:blur(18px) saturate(145%);backdrop-filter:blur(18px) saturate(145%)}
        .ac-login-dealers,.ac-login-home{box-shadow:none!important}

        html[data-theme="light"] .ac-login-page{color:#171b24!important}
        html[data-theme="light"] .ac-login-header{background:rgba(248,249,251,.95)!important;border-bottom-color:rgba(30,36,48,.10)!important}
        html[data-theme="light"] .ac-login-brand-title span:last-child{color:#171b24!important;-webkit-text-fill-color:#171b24!important}
        html[data-theme="light"] .ac-login-brand-subtitle{color:#687284!important;-webkit-text-fill-color:#687284!important}
        html[data-theme="light"] .ac-login-home{background:#e7eaf0!important;color:#394251!important;-webkit-text-fill-color:#394251!important}
        html[data-theme="light"] .ac-login-home:hover{background:#dfe3ea!important;color:#171b24!important;-webkit-text-fill-color:#171b24!important}
        html[data-theme="light"] .ac-login-dealers{background:#171b24!important;border-color:#171b24!important;color:#fff!important;-webkit-text-fill-color:#fff!important}
        html[data-theme="light"] .ac-login-dealers *{color:#fff!important;-webkit-text-fill-color:#fff!important}

        @media(max-width:560px){
          .ac-login-header-actions{gap:.4rem}
          .ac-login-dealers,.ac-login-home{height:38px!important;padding-left:.65rem!important;padding-right:.65rem!important;font-size:12px!important}
          .ac-login-brand{gap:.45rem!important}
          .ac-login-brand-title{font-size:16px!important}
          .ac-login-brand-subtitle{font-size:9px!important}
        }
        @media(max-width:410px){
          .ac-login-home{width:38px!important;padding:0!important;justify-content:center!important;font-size:0!important}
          .ac-login-home::before{content:"⌂";font-size:18px;line-height:1}
          .ac-login-dealers span{display:none}
          .ac-login-dealers{width:38px!important;padding:0!important;justify-content:center!important}
        }
      `}</style>
    </main>
  );
}
