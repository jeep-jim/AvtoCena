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

/* Desktop TopAvto card: keep the outer card, remove only the logo backing.
   The heading and logo share the first row; both paragraphs span the full card below. */
@media (min-width: 768px) {
  html .ac-page-copy.ac-home-page .ac-executor-block {
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) minmax(190px, 240px) !important;
    grid-template-rows: auto auto auto !important;
    align-items: start !important;
    gap: .55rem 1.5rem !important;
    padding: 1.25rem !important;
    background: var(--ac-surface, #f7f8fb) !important;
    background-color: var(--ac-surface, #f7f8fb) !important;
    background-image: none !important;
    border: 0 !important;
    border-radius: 1.6rem !important;
    box-shadow: none !important;
    overflow: visible !important;
  }

  html[data-theme="dark"] .ac-page-copy.ac-home-page .ac-executor-block {
    background: var(--ac-surface, #12151d) !important;
    background-color: var(--ac-surface, #12151d) !important;
  }

  html .ac-page-copy.ac-home-page .ac-executor-block::before,
  html .ac-page-copy.ac-home-page .ac-executor-block::after {
    display: none !important;
    content: none !important;
  }

  html .ac-page-copy.ac-home-page .ac-executor-block > div:first-child {
    display: contents !important;
    background: transparent !important;
  }

  html .ac-page-copy.ac-home-page .ac-executor-block > div:first-child > h3 {
    grid-column: 1 !important;
    grid-row: 1 !important;
    width: 100% !important;
    max-width: none !important;
    margin: 0 !important;
    padding: 0 !important;
    align-self: center !important;
  }

  html .ac-page-copy.ac-home-page .ac-executor-block > div:first-child > p:first-of-type {
    grid-column: 1 / -1 !important;
    grid-row: 2 !important;
    width: 100% !important;
    max-width: none !important;
    margin: .15rem 0 0 !important;
    padding: 0 !important;
  }

  html .ac-page-copy.ac-home-page .ac-executor-block > div:first-child > p:last-of-type {
    grid-column: 1 / -1 !important;
    grid-row: 3 !important;
    width: 100% !important;
    max-width: none !important;
    margin: .2rem 0 0 !important;
    padding: 0 !important;
  }

  html .ac-page-copy.ac-home-page .ac-executor-logo {
    position: static !important;
    grid-column: 2 !important;
    grid-row: 1 !important;
    align-self: start !important;
    justify-self: end !important;
    width: 100% !important;
    min-height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    background: transparent !important;
    background-color: transparent !important;
    background-image: none !important;
    border: 0 !important;
    border-radius: 0 !important;
    box-shadow: none !important;
  }

  html .ac-page-copy.ac-home-page .ac-executor-logo img {
    display: block !important;
    width: 100% !important;
    max-height: 82px !important;
    object-fit: contain !important;
    background: transparent !important;
  }
}

@media (max-width: 767px) {
  /* Put the TopAvto mark inside the heading flow. Only the first line yields to
     the logo; the next line and both paragraphs use the full card width. */
  html .ac-page-copy.ac-home-page .ac-executor-block {
    display: block !important;
    padding: 1rem !important;
  }

  html .ac-page-copy.ac-home-page .ac-executor-block > div:first-child {
    display: block !important;
    min-width: 0 !important;
  }

  html .ac-page-copy.ac-home-page .ac-executor-block > div:first-child > h3 {
    display: flow-root !important;
    width: 100% !important;
    max-width: none !important;
    min-height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    line-height: 1.25 !important;
  }

  html .ac-page-copy.ac-home-page .ac-executor-block > div:first-child > h3::before {
    content: "" !important;
    float: right !important;
    width: 90px !important;
    height: 24px !important;
    margin: 0 0 .25rem .65rem !important;
    background-image: url("/brands/topavto-logo.png") !important;
    background-repeat: no-repeat !important;
    background-position: center !important;
    background-size: contain !important;
  }

  html[data-theme="light"] .ac-page-copy.ac-home-page .ac-executor-block > div:first-child > h3::before {
    background-image: url("/brands/topavto-logo-black.png") !important;
  }

  html .ac-page-copy.ac-home-page .ac-executor-block > div:first-child > p {
    width: 100% !important;
    max-width: none !important;
    min-width: 0 !important;
    margin-left: 0 !important;
    margin-right: 0 !important;
  }

  html .ac-page-copy.ac-home-page .ac-executor-block > div:first-child > p:first-of-type {
    margin-top: .7rem !important;
  }

  html .ac-page-copy.ac-home-page .ac-executor-block > div:first-child > p:last-of-type {
    margin-top: .45rem !important;
  }

  html .ac-page-copy.ac-home-page .ac-executor-logo {
    display: none !important;
  }

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
