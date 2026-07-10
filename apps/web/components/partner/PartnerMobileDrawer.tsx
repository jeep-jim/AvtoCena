import Link from "next/link";
import { BrandMark } from "@/components/brand/BrandMark";

function DrawerArrowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M3 9H14M10 5L14 9L10 13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DrawerHandshakeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M7.5 12.2L10.2 9.5C11 8.7 12.2 8.7 13 9.5L14.5 11C15.2 11.7 16.3 11.7 17 11L18.2 9.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.5 12.5L7.3 16.3C8.1 17.1 9.4 17.1 10.2 16.3L11 15.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20.5 12.5L16.7 16.3C15.9 17.1 14.6 17.1 13.8 16.3L9.8 12.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 9.5L6.5 6H9.5M21 9.5L17.5 6H14.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DrawerHomeIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M4 11.5L12 4L20 11.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.5 10.5V20H17.5V10.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 20V15H14V20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DrawerGridIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M4 5.5C4 4.7 4.7 4 5.5 4H10V10H4V5.5Z" stroke="currentColor" strokeWidth="2" />
      <path d="M14 4H18.5C19.3 4 20 4.7 20 5.5V10H14V4Z" stroke="currentColor" strokeWidth="2" />
      <path d="M4 14H10V20H5.5C4.7 20 4 19.3 4 18.5V14Z" stroke="currentColor" strokeWidth="2" />
      <path d="M14 14H20V18.5C20 19.3 19.3 20 18.5 20H14V14Z" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function PartnerMobileDrawer({
  cabinetHref,
  canSeeApi,
  showLogin
}: {
  cabinetHref: string;
  canSeeApi: boolean;
  showLogin: boolean;
}) {
  return (
    <div className="ac-mobile-menu md:hidden">
      <input id="partner-mobile-menu-toggle" className="ac-mobile-menu__input" type="checkbox" aria-hidden="true" />

      <label htmlFor="partner-mobile-menu-toggle" className="ac-mobile-menu__burger" aria-label="Открыть меню">
        <svg width="19" height="14" viewBox="0 0 19 14" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 1H18M1 7H18M1 13H18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </label>

      <label htmlFor="partner-mobile-menu-toggle" className="ac-mobile-menu__backdrop" aria-label="Закрыть меню" />

      <aside className="ac-mobile-menu__panel" aria-label="Мобильное меню">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <BrandMark className="h-9 w-9 shrink-0" />
            <div>
              <div className="text-xl font-black leading-none">
                <span className="text-red-500">Авто</span>
                <span className="text-white">Цена</span>
              </div>
              <div className="mt-1 text-xs font-bold uppercase tracking-[0.18em] text-white/42">партнёрам</div>
            </div>
          </div>

          <label htmlFor="partner-mobile-menu-toggle" className="ac-mobile-menu__close" aria-label="Закрыть меню">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2 2L14 14M14 2L2 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </label>
        </div>

        <nav className="mt-9 grid gap-3">
          <Link href="/" className="ac-mobile-menu__link">
            <span>Главная</span>
            <span className="ac-mobile-menu__icon" aria-hidden="true">
              <DrawerHomeIcon />
            </span>
          </Link>

          <Link href="/partner/landing" className="ac-mobile-menu__link">
            <span>Партнёрам</span>
            <span className="ac-mobile-menu__icon" aria-hidden="true">
              <DrawerHandshakeIcon />
            </span>
          </Link>

          <Link href={cabinetHref} className="ac-mobile-menu__link">
            <span>Кабинет</span>
            <span className="ac-mobile-menu__icon" aria-hidden="true">
              <DrawerGridIcon />
            </span>
          </Link>

          {canSeeApi && (
            <Link href="/partner/api" className="ac-mobile-menu__link">
              <span>CPA API</span>
              <span className="ac-mobile-menu__icon" aria-hidden="true">
                <DrawerGridIcon />
              </span>
            </Link>
          )}

          {showLogin && (
            <Link href="/login?next=/partner" className="ac-mobile-menu__link ac-mobile-menu__link--red">
              <span>Вход</span>
              <span className="ac-mobile-menu__icon ac-mobile-menu__icon--red" aria-hidden="true">
                <DrawerArrowIcon />
              </span>
            </Link>
          )}
        </nav>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm font-medium leading-6 text-white/55">
          Для менеджеров TopAvto и партнёров. CRM и CPA API доступны только после входа.
        </div>

        <div className="mt-auto pt-8 text-xs font-bold leading-5 text-white/32">
          avtocena.com
        </div>
      </aside>
    </div>
  );
}
