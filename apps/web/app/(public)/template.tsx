"use client";

import { useEffect, type ReactNode } from "react";
import { LeadCaptureInteractionEnhancer } from "@/components/leads/LeadCaptureInteractionEnhancer";
import { PublicLeadCaptureV2 } from "@/components/leads/PublicLeadCaptureV2";
import { PublicLeadCaptureStyles } from "@/components/leads/PublicLeadCaptureStyles";

const publicVisualFixes = `
/* One neutral dark canvas across every public page. This matches the footer
   area instead of introducing page-specific grey or colored gradients. */
html:not([data-theme="light"]) body {
  background: #07090f !important;
  background-color: #07090f !important;
  background-image: none !important;
}

html:not([data-theme="light"]) body main,
html:not([data-theme="light"]) body .ac-page-copy,
html:not([data-theme="light"]) body .ac-partner-page {
  background: #07090f !important;
  background-color: #07090f !important;
  background-image: none !important;
}

/* The left dealer CTA already exists in the footer, so do not repeat it
   inside the Sections column. */
.ac-public-footer-navigation nav[aria-label="Разделы"] a[href="/dealers"] {
  display: none !important;
}

@media (max-width: 767px) {
  /* Horizontal rails must not capture the vertical page gesture. Keep native
     horizontal swiping while allowing the page to scroll when the finger
     starts on currencies or brands. */
  .ac-home-page .ac-brand-rail .touch-pan-x,
  .ac-home-page .ac-currency-rates-strip .touch-pan-x {
    touch-action: pan-x pan-y !important;
  }
}

/* Mobile filter overlays use the same bottom-sheet interaction as currency details. */
@media (max-width: 1023px) {
  .ac-home-page > div.fixed:has(> .ac-home-filter-drawer) {
    display: flex !important;
    align-items: flex-end !important;
    justify-content: center !important;
    background: rgba(0,0,0,.62) !important;
    -webkit-backdrop-filter: blur(8px) !important;
    backdrop-filter: blur(8px) !important;
  }
  .ac-home-page > div.fixed > .ac-home-filter-drawer {
    position: relative !important;
    inset: auto !important;
    width: 100% !important;
    max-width: none !important;
    max-height: min(91dvh, 820px) !important;
    border-radius: 30px 30px 0 0 !important;
    padding: 28px 16px calc(14px + env(safe-area-inset-bottom)) !important;
    overflow-y: auto !important;
    background: var(--ac-surface) !important;
    color: var(--ac-text) !important;
    overscroll-behavior: contain !important;
  }
  .ac-home-page > div.fixed > .ac-home-filter-drawer::before {
    content: "" !important;
    position: absolute !important;
    top: 9px !important;
    left: 50% !important;
    width: 48px !important;
    height: 6px !important;
    transform: translateX(-50%) !important;
    border-radius: 999px !important;
    background: var(--ac-muted) !important;
    opacity: .3 !important;
  }
  .ac-home-page .ac-home-filter-drawer__header {
    margin: 0 0 14px !important;
    padding: 0 !important;
  }
  .ac-home-page .ac-home-filter-drawer__header button { border-radius: 999px !important; }
  .ac-home-page .ac-home-filter-drawer__fields {
    display: flex !important;
    flex-direction: column !important;
    gap: 10px !important;
  }
  .ac-home-page .ac-home-filter-drawer__budget {
    padding: 10px 12px !important;
    border-radius: 16px !important;
    background: var(--ac-surface-2) !important;
  }
  .ac-home-page .ac-home-filter-drawer__actions {
    position: sticky !important;
    bottom: -1px !important;
    z-index: 20 !important;
    margin: 12px -4px -4px !important;
    padding: 10px 4px 4px !important;
    background: var(--ac-surface) !important;
  }
  .ac-home-page .ac-home-filter-drawer .ac-filter-dropdown {
    position: static !important;
    inset: auto !important;
    margin-top: 6px !important;
    background: var(--ac-surface-3) !important;
    border: 1px solid var(--ac-border) !important;
    box-shadow: none !important;
  }
  .ac-home-page .ac-home-filter-drawer .relative:has(> .ac-filter-dropdown) { z-index: auto !important; }
  .ac-home-page .ac-home-filter-drawer .ac-filter-control,
  .ac-home-page .ac-home-filter-drawer .ac-search-select {
    min-height: 52px !important;
    height: 52px !important;
    border-radius: 15px !important;
  }

  /* Keep only the lower budget selector next to the red CTA on mobile. */
  html body .ac-home-page #form > div:nth-child(2) {
    display: none !important;
    visibility: hidden !important;
    height: 0 !important;
    min-height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
    pointer-events: none !important;
  }
}

/* The finance cards reuse an older class that previously forced overflow:visible.
   Override that legacy rule only inside the finance section so mascot artwork
   stays inside the rounded card and the authored text layout is preserved. */
@media (min-width: 1024px) {
  .ac-home-page section[aria-label="Финансовые сервисы"] .ac-executor-block {
    display: block !important;
    position: relative !important;
    overflow: hidden !important;
    padding: 24px !important;
    border-radius: 1.6rem !important;
  }
  .ac-home-page section[aria-label="Финансовые сервисы"] .ac-executor-block > div:first-child {
    display: block !important;
    position: relative !important;
    background: transparent !important;
  }
  .ac-home-page section[aria-label="Финансовые сервисы"] .ac-executor-block > div:first-child > div:first-child {
    display: flex !important;
  }
  .ac-home-page section[aria-label="Финансовые сервисы"] .ac-executor-block > div:first-child > p {
    display: block !important;
    width: auto !important;
    max-width: 350px !important;
    margin-top: 32px !important;
  }
  .ac-home-page section[aria-label="Финансовые сервисы"] .ac-executor-block > img,
  .ac-home-page section[aria-label="Финансовые сервисы"] .ac-finance-card > img,
  .ac-offer-finance-cards .ac-finance-card > img {
    width: 180px !important;
    height: 200px !important;
    max-width: none !important;
    right: 8px !important;
    bottom: 0 !important;
    object-fit: contain !important;
    object-position: center bottom !important;
  }
}
`;

export default function PublicTemplate({ children }: { children: ReactNode }) {
  useEffect(() => {
    const closeOpenDetails = (target?: EventTarget | null) => {
      const node = target instanceof Node ? target : null;
      document.querySelectorAll<HTMLDetailsElement>("details[open]").forEach((details) => {
        if (!node || !details.contains(node)) details.removeAttribute("open");
      });
    };

    const normalizeLeadBannerCopy = () => {
      document.querySelectorAll<HTMLButtonElement>(".ac-lead-capture-banner .avto-button").forEach((button) => {
        if (button.textContent?.trim() === "Оставить заявку") button.textContent = "Оставить запрос";
      });
    };

    const applyFinanceUiHotfix = () => {
      const mobile = window.matchMedia("(max-width: 1023px)").matches;
      const form = document.querySelector<HTMLElement>(".ac-home-page #form");
      const upperBudget = form?.children.item(1);
      if (upperBudget instanceof HTMLElement) {
        if (mobile) {
          upperBudget.style.setProperty("display", "none", "important");
          upperBudget.setAttribute("aria-hidden", "true");
        } else {
          upperBudget.style.removeProperty("display");
          upperBudget.removeAttribute("aria-hidden");
        }
      }

      document.querySelectorAll<HTMLImageElement>('img[src="/home/credit-mascot.webp"], img[src="/home/credit-mascot.png"]').forEach((image) => {
        image.setAttribute("src", "/home/credit-mascot-card.png");
      });
      document.querySelectorAll<HTMLImageElement>('img[src="/home/osago-mascot.webp"], img[src="/home/osago-mascot.png"]').forEach((image) => {
        image.setAttribute("src", "/home/osago-mascot-card.png");
      });
    };

    const pointerDown = (event: PointerEvent) => {
      closeOpenDetails(event.target);
      window.dispatchEvent(new CustomEvent("avtocena:dismiss-tooltips", { detail: { target: event.target } }));
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeOpenDetails();
      window.dispatchEvent(new CustomEvent("avtocena:dismiss-tooltips"));
    };

    const observer = new MutationObserver(() => {
      normalizeLeadBannerCopy();
      applyFinanceUiHotfix();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    normalizeLeadBannerCopy();
    applyFinanceUiHotfix();

    document.addEventListener("pointerdown", pointerDown, true);
    window.addEventListener("keydown", keyDown);
    window.addEventListener("resize", applyFinanceUiHotfix);
    window.addEventListener("pageshow", applyFinanceUiHotfix);
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", pointerDown, true);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("resize", applyFinanceUiHotfix);
      window.removeEventListener("pageshow", applyFinanceUiHotfix);
    };
  }, []);

  return <>
    {children}
    <PublicLeadCaptureV2 />
    <LeadCaptureInteractionEnhancer />
    <PublicLeadCaptureStyles />
    <style dangerouslySetInnerHTML={{ __html: publicVisualFixes }} />
  </>;
}
