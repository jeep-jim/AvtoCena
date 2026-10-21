import {notFound} from "next/navigation";
import {getCurrentUser} from "@/lib/auth";
import {isPlatformTeam} from "@/lib/platform-access";
import type { Metadata } from "next";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { DealerDemoDashboard } from "@/components/dealers/DealerDemoDashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: {index:false, follow:false, nocache:true},
  title: "Демо CRM для автодилеров — АвтоЦена",
  description: "Посмотрите демонстрационный кабинет АвтоЦена для компаний по привозу автомобилей: заявки, команда, клиенты и аналитика.",
};

export default async function DealersDemoPage({searchParams}: {searchParams: Promise<{preview?:string}>}) {
  if ((await searchParams).preview !== "1" || !isPlatformTeam(await getCurrentUser())) notFound();
  return (
    <main className="ac-page-copy min-h-screen bg-[#07080d] text-white">
      <PublicHeader backHref="/dealers?preview=1" backLabel="Для дилеров" />
      <DealerDemoDashboard />
    </main>
  );
}
