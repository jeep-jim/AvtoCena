"use client";

import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";

type Hosts = {
  desktop: HTMLElement | null;
  mobile: HTMLElement | null;
};

function ActionButtons({ className = "" }: { className?: string }) {
  const buttonClass = "ac-offer-contact-button h-14 min-w-0 rounded-[1.35rem] px-3 text-[13px] font-black leading-none !text-white transition-[filter,transform] hover:brightness-95 active:scale-[.99] sm:text-sm md:text-base";
  return (
    <div className={`grid grid-cols-2 gap-3 md:gap-4 ${className}`}>
      <button
        type="button"
        data-offer-action="messenger"
        className={`${buttonClass} bg-[#00A2E8]`}
      >
        Чат в мессенджере
      </button>
      <button
        type="button"
        data-offer-action="lead"
        className={`${buttonClass} bg-[#22B14C]`}
      >
        Оставить заявку
      </button>
    </div>
  );
}

function MobilePinnedActions() {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [fixedStyle, setFixedStyle] = useState<CSSProperties | null>(null);

  useEffect(() => {
    let frame = 0;

    const update = () => {
      frame = 0;
      const anchor = anchorRef.current;
      if (!anchor || window.innerWidth >= 1280) {
        setFixedStyle(null);
        return;
      }

      const rect = anchor.getBoundingClientRect();
      const bottomOffset = 10;
      const buttonHeight = 56;
      const fixedTop = window.innerHeight - bottomOffset - buttonHeight;
      const shouldFix = rect.top <= fixedTop;

      setFixedStyle(shouldFix ? {
        position: "fixed",
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        bottom: "max(10px, env(safe-area-inset-bottom))",
        zIndex: 80,
      } : null);
    };

    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);

    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={anchorRef} className="relative mt-4 h-14 xl:hidden">
      <div style={fixedStyle || undefined} className="w-full">
        <ActionButtons />
      </div>
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
      {hosts.mobile ? createPortal(<MobilePinnedActions />, hosts.mobile) : null}
      <style jsx global>{`
        .ac-offer-contact-button {
          color: #fff !important;
        }
      `}</style>
    </>
  );
}
