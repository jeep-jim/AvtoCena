import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { PartnerMobileDrawer } from "@/components/partner/PartnerMobileDrawer";
import { BrandMark } from "@/components/brand/BrandMark";

export function PartnerShell({
  title,
  subtitle,
  children
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const user = getCurrentUser();
  const canSeeApi = isAdminRole(user?.role);

  const cabinetHref = user ? "/partner" : "/login?next=/partner";

  return (
    <main className="min-h-screen w-full max-w-[100vw] overflow-x-hidden px-4 py-5 md:px-8 md:py-6">
      <div className="mx-auto w-full max-w-[1500px] overflow-x-hidden">
        <header className="flex items-center justify-between gap-4">
          <a href="/" className="flex min-w-0 items-center gap-2.5 md:gap-3">
            <BrandMark className="h-9 w-9 shrink-0 md:h-10 md:w-10" />
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
          </a>

          <nav className="hidden flex-wrap gap-2 md:flex">
            <a className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white/70 transition hover:bg-white/14" href="/partner/landing">
              Партнёрам
            </a>
            <a className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white/70 transition hover:bg-white/14" href={cabinetHref}>
              Кабинет
            </a>
            {canSeeApi && (
              <a className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white/70 transition hover:bg-white/14" href="/partner/api">
                CPA API
              </a>
            )}
            {!user && (
              <a className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white/70 transition hover:bg-white/14" href="/login?next=/partner">
                Вход
              </a>
            )}
          </nav>

          <PartnerMobileDrawer
            cabinetHref={cabinetHref}
            canSeeApi={canSeeApi}
            showLogin={!user}
          />
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
