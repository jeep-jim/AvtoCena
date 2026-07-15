import Link from "next/link";
import { PartnerNavigation } from "@/components/partner/PartnerNavigation";

export function PartnerShell({
  title,
  subtitle,
  children
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <main className="ac-partner-page min-h-screen w-full max-w-[100vw] overflow-x-hidden px-4 py-5 md:px-8 md:py-6">
      <div className="mx-auto w-full max-w-7xl overflow-x-hidden">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="flex min-w-0 items-center gap-3">
            <div className="min-w-0">
              <div className="text-[18px] font-black leading-none md:text-[22px]">
                <span className="text-red-500">Авто</span>
                <span className="text-white">Цена</span>
                <span className="text-white"> Partners</span>
              </div>
              <div className="text-xs font-bold leading-none text-white/45">
                реферальная система
              </div>
            </div>
          </Link>

          <PartnerNavigation />
        </header>

        <section className="mt-8">
          <div className="mb-6">
            <div className="text-sm font-black uppercase tracking-[0.18em] text-red-300">
              Партнёрам
            </div>
            <h1 className="mt-2 text-[38px] font-black leading-[0.96] tracking-[-0.04em] md:text-5xl">
              {title}
            </h1>
            <p className="mt-3 max-w-3xl text-sm font-medium leading-7 text-white/62 md:text-base">
              {subtitle}
            </p>
          </div>
          {children}
        </section>
      </div>
    </main>
  );
}
