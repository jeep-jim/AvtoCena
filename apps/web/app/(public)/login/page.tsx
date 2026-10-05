import {AccountEntrance} from "@/components/account/AccountEntrance";
import type { Metadata } from "next";
import { PublicHeader } from "@/components/layout/PublicHeader";
import {publicDealerProfile} from '@/lib/dealers/public-profile';
import {publicRail} from '@/lib/dealers/public-rail';
import {availableShowcase} from '@/lib/dealers/program-store';
import {withDealerRate} from '@/lib/dealers/exchange-rate';
import {PILOT_DEALER_ID} from '@/lib/dealers/showcase-model';
import {readPublicFeatures,readShowcase,findDealer} from "@/lib/dealers/showcase-store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Вход — АвтоЦена",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = (await searchParams) ?? {};
  const nextPath = firstParam(params.next) || "/account";
  const errorCode = firstParam(params.error) || "";
  const features = await readPublicFeatures();
  const stored = await readShowcase(PILOT_DEALER_ID);
  const dealer = stored?.profileEnabled ? await withDealerRate(await availableShowcase(stored)) : null;
  const topDealer = dealer?.profileEnabled ? {profile:publicDealerProfile(dealer),items:publicRail(dealer),verified:(await findDealer(PILOT_DEALER_ID))?.status==='verified'} : undefined;

  return (
    <main className="ac-login-page ac-page-copy min-h-screen text-white">
      <PublicHeader backHref="/" backLabel="Назад" />

      <section className="mx-auto max-w-7xl px-4 py-5 md:px-8 md:py-10">
        <div className="w-full max-w-[1240px]">
          <AccountEntrance topDealer={topDealer} appearance={features.accountAppearance} nextPath={nextPath} errorCode={errorCode} initialRole={firstParam(params.role) || (nextPath.startsWith("/crm") || nextPath.startsWith("/dealer-cabinet") ? "dealer" : "customer")} />
        </div>
      </section>

      <style>{`
        .ac-login-page::after{display:none!important}
        html[data-theme="light"] .ac-login-page{color:var(--ac-text)!important}
        html[data-theme="light"] .ac-login-error{background:#f9e3e6!important;color:#941c28!important;-webkit-text-fill-color:#941c28!important}
      `}</style>
    </main>
  );
}
