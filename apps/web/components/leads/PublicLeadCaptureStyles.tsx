"use client";

export function PublicLeadCaptureStyles() {
  return <style jsx global>{`
    .ac-colored-button,
    .ac-colored-button *,
    .ac-lead-capture-banner .avto-button,
    .ac-lead-dialog .avto-button {
      color: #fff !important;
      -webkit-text-fill-color: #fff !important;
    }
    .ac-lead-error {
      color: #e31b23 !important;
      -webkit-text-fill-color: #e31b23 !important;
    }
    .ac-success-check {
      color: #fff !important;
      -webkit-text-fill-color: #fff !important;
    }
    html[data-theme="light"] .ac-lead-dialog .ac-lead-comment {
      color: #5f6878 !important;
      -webkit-text-fill-color: #5f6878 !important;
    }
    html[data-theme="light"] .ac-lead-dialog .ac-lead-comment::placeholder {
      color: #8c96a7 !important;
      opacity: 1 !important;
    }
    .ac-lead-sheet-handle span {
      background: rgba(255,255,255,.60) !important;
      box-shadow: 0 1px 5px rgba(0,0,0,.28) !important;
    }
    html[data-theme="light"] .ac-lead-sheet-handle span {
      background: rgba(255,255,255,.85) !important;
    }
    .ac-lead-banner-manager {
      display: block !important;
      background: transparent !important;
      filter: none !important;
    }
    .ac-lead-capture-banner > .min-w-0 > div:first-child {
      display: none !important;
    }
    .ac-lead-capture-banner > .min-w-0 > h2 {
      margin-top: 0 !important;
    }

    /* Favorites selection is marked by the red check only. */
    .ac-lead-favorites-list > button {
      background: var(--ac-surface-2) !important;
    }

    /* Keep card price arrows inside the cards and below fixed favorites UI. */
    body:has([data-ac-favorites-bar]) .ac-favorites-card {
      contain: paint !important;
      isolation: isolate !important;
      z-index: 0 !important;
    }
    body:has([data-ac-favorites-bar]) .ac-favorites-card .ac-price-trend-arrow {
      z-index: 0 !important;
    }
    body:has([data-ac-favorites-bar]) [data-ac-favorites-bar] {
      z-index: 10000 !important;
    }
    body:has([data-ac-favorites-bar]) .ac-public-header {
      z-index: 10001 !important;
    }

    /* The catalog link is navigation, not a lead CTA. Match the dealer button. */
    html:not([data-theme="light"]) .ac-public-legal-footer .ac-public-footer-cta {
      background: rgba(255,255,255,.07) !important;
      background-color: rgba(255,255,255,.07) !important;
      background-image: none !important;
      color: var(--ac-text) !important;
      -webkit-text-fill-color: var(--ac-text) !important;
      box-shadow: none !important;
      transition: background-color .18s ease !important;
    }
    html:not([data-theme="light"]) .ac-public-legal-footer .ac-public-footer-cta:hover {
      background: rgba(255,255,255,.12) !important;
      background-color: rgba(255,255,255,.12) !important;
      background-image: none !important;
    }
    html[data-theme="light"] .ac-public-legal-footer .ac-public-footer-cta {
      background: #fff !important;
      background-color: #fff !important;
      background-image: none !important;
      color: var(--ac-text) !important;
      -webkit-text-fill-color: var(--ac-text) !important;
      box-shadow: 0 7px 20px rgba(38,43,57,.08) !important;
    }
    html[data-theme="light"] .ac-public-legal-footer .ac-public-footer-cta:hover {
      background: #f8f9fb !important;
      background-color: #f8f9fb !important;
      background-image: none !important;
    }

    /* Match the dark currency sheet surface to the lead form. */
    html:not([data-theme="light"]) .ac-rate-sheet,
    html:not([data-theme="light"]) .ac-rate-sheet > .sticky {
      background: var(--ac-surface) !important;
      color: var(--ac-text) !important;
    }

    body:has(main.ac-home-page) main.ac-home-page > div.mx-auto {
      padding-bottom: 1rem !important;
    }
    body:has(main.ac-home-page) .ac-public-legal-footer {
      margin-top: 1.5rem !important;
    }
  `}</style>;
}
