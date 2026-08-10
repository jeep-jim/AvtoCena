"use client";

import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";

type Hosts = {
  desktop: HTMLElement | null;
  mobile: HTMLElement | null;
};

function ActionButtons({ className = "" }: { className?: string }) {
  const buttonClass = "ac-offer-contact-button inline-flex h-[54px] min-w-0 items-center justify-center gap-2.5 rounded-[1.05rem] px-3 text-[13px] font-black leading-none !text-white transition-[filter,transform] hover:brightness-95 active:scale-[.99] sm:text-sm md:text-base xl:h-14";
  return (
    <div className={`grid grid-cols-2 gap-3 md:gap-4 ${className}`}>
      <button
        type="button"
        data-offer-action="messenger"
        className={`${buttonClass} bg-[#00A2E8]`}
      >
        <span className="hidden xl:inline-flex" aria-hidden="true"><svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M5 5.5h14a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 19 17.5h-7.1L7 21v-3.5H5A2.5 2.5 0 0 1 2.5 15V8A2.5 2.5 0 0 1 5 5.5Z" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/><path d="M7.5 10h9M7.5 13.5h6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/></svg></span>
        <span>Чат в мессенджере</span>
      </button>
      <button
        type="button"
        data-offer-action="lead"
        className={`${buttonClass} bg-[#22B14C]`}
      >
        <span>Оставить заявку</span>
        <span className="hidden xl:inline-flex" aria-hidden="true"><svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M7.2 3.8 10 8.3 8.4 10a14.7 14.7 0 0 0 5.6 5.6l1.7-1.6 4.5 2.8c.5.3.7.9.5 1.4-.5 1.4-1.8 2.4-3.3 2.5C10.1 21.1 2.9 13.9 3.3 6.6c.1-1.5 1.1-2.8 2.5-3.3.5-.2 1.1 0 1.4.5Z" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
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
      const header = document.querySelector<HTMLElement>(".ac-public-header");
      const headerBottom = header ? Math.max(0, header.getBoundingClientRect().bottom) : 64;
      const fixedTop = headerBottom + 8;
      const shouldFix = rect.top <= fixedTop;

      setFixedStyle(shouldFix ? {
        position: "fixed",
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        top: `${fixedTop}px`,
        zIndex: 45,
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
    <div ref={anchorRef} className="relative mt-4 h-[54px] xl:hidden">
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
        .ac-offer-page > section > section {
          border-top: 1px solid rgba(255,255,255,.085) !important;
          padding-top: 1rem;
        }
        html[data-theme="light"] .ac-offer-page > section > section {
          border-top-color: rgba(35,42,55,.12) !important;
        }
      `}</style>
    </>
  );
}
