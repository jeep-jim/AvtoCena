"use client";

import { useEffect, type ReactNode } from "react";
import { PublicLeadCapture } from "@/components/leads/PublicLeadCapture";

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
`;

export default function PublicTemplate({ children }: { children: ReactNode }) {
  useEffect(() => {
    const closeOpenDetails = (target?: EventTarget | null) => {
      const node = target instanceof Node ? target : null;
      document.querySelectorAll<HTMLDetailsElement>("details[open]").forEach((details) => {
        if (!node || !details.contains(node)) details.removeAttribute("open");
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

    document.addEventListener("pointerdown", pointerDown, true);
    window.addEventListener("keydown", keyDown);
    return () => {
      document.removeEventListener("pointerdown", pointerDown, true);
      window.removeEventListener("keydown", keyDown);
    };
  }, []);

  return <>
    {children}
    <PublicLeadCapture />
    <style dangerouslySetInnerHTML={{ __html: publicVisualFixes }} />
  </>;
}
