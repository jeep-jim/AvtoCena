import {canManageDealer} from "@/lib/dealers/access";
import {publicDealerProfile} from "@/lib/dealers/public-profile";
import {publicRail} from "@/lib/dealers/public-showcase";
import {DealerProfileContent} from "@/components/dealers/DealerProfileContent";
import {dealerProfilePath} from '@/lib/dealers/profile-url';
import {withDealerRate} from '@/lib/dealers/exchange-rate';
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { readShowcase } from "@/lib/dealers/showcase-store";
import { PublicHeader } from "@/components/layout/PublicHeader";
export const dynamic = "force-dynamic";
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const s = await readShowcase((await params).id);
  if (!s?.profileEnabled || (await searchParams).preview)
    return {
      title: "Дилер — АвтоЦена",
      robots: { index: false, follow: false },
    };
  return {
    title: `${s.name} — дилер на АвтоЦена`,
    description: publicDealerProfile(s).description.slice(0, 200),
    alternates: { canonical: dealerProfilePath(s) },
  };
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  let s = await readShowcase((await params).id);
  const preview =
    (await searchParams).preview === "1" &&
    await canManageDealer(await getCurrentUser(),(await params).id);
  if (!s || (!s.profileEnabled && !preview)) notFound();
  if(s.specialsEnabled)s=await withDealerRate(s);
  return (
    <main className="ac-page-copy min-h-screen bg-[var(--ac-bg)] text-[var(--ac-text)]">
      <PublicHeader backHref="/" backLabel="На главную" />
      <DealerProfileContent s={publicDealerProfile(s)} preview={preview} items={publicRail(s)} />
    </main>
  );
}
