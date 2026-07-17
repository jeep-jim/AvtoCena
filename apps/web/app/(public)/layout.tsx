import "../flat-ui.css";
import "../public-regression-fixes.css";
import "../public-price-sheet-fix.css";

const priceTrendTapGuard = `
(() => {
  if (window.__acPriceTrendTapGuard) return;
  window.__acPriceTrendTapGuard = true;
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element
      ? event.target.closest(".ac-price-trend-arrow")
      : null;
    if (target) event.preventDefault();
  }, true);
})();
`;

const publicPageFixes = `
.ac-public-footer-navigation nav[aria-label="Разделы"] a[href="/#form"],
.ac-public-legal-footer-line nav[aria-label="Правовая информация"] a {
  display: none !important;
}

@media (max-width: 767px) {
  .ac-price-trend-popover {
    position: fixed !important;
    top: auto !important;
    right: max(12px, env(safe-area-inset-right)) !important;
    bottom: max(12px, env(safe-area-inset-bottom)) !important;
    left: auto !important;
    z-index: 2147483000 !important;
    width: min(290px, calc(100vw - 24px)) !important;
    max-height: calc(100dvh - 24px) !important;
    overflow-y: auto !important;
  }

  .ac-price-trend-popover > span:last-child {
    display: none !important;
  }
}
`;

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <style dangerouslySetInnerHTML={{ __html: publicPageFixes }} />
      <script dangerouslySetInnerHTML={{ __html: priceTrendTapGuard }} />
    </>
  );
}
