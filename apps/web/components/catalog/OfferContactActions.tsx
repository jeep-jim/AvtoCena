"use client";

import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type Hosts = {
  desktop: HTMLElement | null;
  mobile: HTMLElement | null;
};

function ActionButtons({ className = "" }: { className?: string }) {
  return (
    <div className={`grid grid-cols-2 gap-3 md:gap-4 ${className}`}>
      <button
        type="button"
        data-offer-action="messenger"
        className="h-14 min-w-0 rounded-xl bg-[#00A2E8] px-3 text-[13px] font-black leading-none text-white transition-[filter,transform] hover:brightness-95 active:scale-[.99] sm:text-sm md:text-base"
      >
        Чат в мессенджере
      </button>
      <button
        type="button"
        data-offer-action="lead"
        className="h-14 min-w-0 rounded-xl bg-[#22B14C] px-3 text-[13px] font-black leading-none text-white transition-[filter,transform] hover:brightness-95 active:scale-[.99] sm:text-sm md:text-base"
      >
        Оставить заявку
      </button>
    </div>
  );
}

export function OfferContactActions() {
  const pathname = usePathname();
  const [hosts, setHosts] = useState<Hosts>({ desktop: null, mobile: null });

  useEffect(() => {
    document.querySelectorAll<HTMLElement>("[data-offer-actions-host]").forEach((node) => node.remove());
    setHosts({ desktop: null, mobile: null });

    if (!pathname?.startsWith("/cars/offer/")) return;

    let cancelled = false;
    let frame = 0;
    let desktopHost: HTMLElement | null = null;
    let mobileHost: HTMLElement | null = null;

    const mount = () => {
      if (cancelled) return;
      const page = document.querySelector<HTMLElement>("main.ac-offer-page");
      const section = page?.querySelector<HTMLElement>(":scope > section");
      const grid = section?.querySelector<HTMLElement>(":scope > div.grid");
      const mediaColumn = grid?.children?.[0] as HTMLElement | undefined;

      if (!page || !section || !grid || !mediaColumn) {
        frame = window.requestAnimationFrame(mount);
        return;
      }

      desktopHost = document.createElement("div");
      desktopHost.dataset.offerActionsHost = "desktop";
      mediaColumn.appendChild(desktopHost);

      mobileHost = document.createElement("div");
      mobileHost.dataset.offerActionsHost = "mobile";
      grid.insertAdjacentElement("afterend", mobileHost);

      if (!cancelled) setHosts({ desktop: desktopHost, mobile: mobileHost });
    };

    mount();

    return () => {
      cancelled = true;
      if (frame) window.cancelAnimationFrame(frame);
      desktopHost?.remove();
      mobileHost?.remove();
    };
  }, [pathname]);

  return (
    <>
      {hosts.desktop ? createPortal(<ActionButtons className="mt-5 hidden xl:grid" />, hosts.desktop) : null}
      {hosts.mobile ? createPortal(<ActionButtons className="mt-4 xl:hidden" />, hosts.mobile) : null}
    </>
  );
}
