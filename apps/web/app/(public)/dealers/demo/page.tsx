import type { Metadata } from "next";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { DealerDemoDashboard } from "@/components/dealers/DealerDemoDashboard";

export const metadata: Metadata = {
  title: "Демо CRM для автодилеров — АвтоЦена",
  description: "Посмотрите демонстрационный кабинет АвтоЦена для компаний по привозу автомобилей: заявки, команда, клиенты и аналитика.",
};

export default function DealersDemoPage() {
  return (
    <main className="ac-page-copy min-h-screen bg-[#07080d] text-white">
      <PublicHeader backHref="/dealers" backLabel="Для дилеров" />
      <DealerDemoDashboard />
    </main>
  );
}
