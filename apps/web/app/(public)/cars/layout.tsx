export default function CarsLayout({ children }: { children: React.ReactNode }) {
  return <>
    {children}
    <style>{`
      html:not([data-theme="light"]) .ac-catalog-page.ac-page-copy {
        background: #07090f !important;
        background-color: #07090f !important;
        background-image: none !important;
      }

      @media (max-width: 767px) {
        .ac-catalog-page .ac-brand-rail,
        .ac-catalog-page .ac-currency-rates-strip {
          display: none !important;
        }
      }

      /* Offer header stays one line. Long text scrolls horizontally instead of wrapping. */
      .ac-offer-page nav[aria-label="Хлебные крошки"] {
        flex-wrap: nowrap !important;
        overflow-x: auto !important;
        overflow-y: hidden !important;
        white-space: nowrap !important;
        scrollbar-width: none;
        overscroll-behavior-inline: contain;
        -webkit-overflow-scrolling: touch;
      }
      .ac-offer-page nav[aria-label="Хлебные крошки"]::-webkit-scrollbar {
        display: none;
      }
      .ac-offer-page nav[aria-label="Хлебные крошки"] > * {
        flex: 0 0 auto !important;
      }
      .ac-offer-page h1 {
        white-space: nowrap !important;
        overflow-x: auto !important;
        overflow-y: hidden !important;
        word-break: normal !important;
        overflow-wrap: normal !important;
        scrollbar-width: none;
        overscroll-behavior-inline: contain;
        -webkit-overflow-scrolling: touch;
        clip-path: inset(0 0 0 2.7rem);
      }
      .ac-offer-page h1::-webkit-scrollbar {
        display: none;
      }
      .ac-offer-page header .ac-favorite-button {
        z-index: 20 !important;
        border-radius: 9999px !important;
        background: transparent !important;
      }
      @media (min-width: 768px) {
        .ac-offer-page h1 {
          clip-path: inset(0 0 0 3.35rem);
        }
      }

      /* Keep the status card's original typography: the update line takes the old heading style, the confirmation stays the old small copy. */
      .ac-offer-page .ac-offer-status .ac-offer-status-copy > span:first-child {
        font-size: 1rem !important;
        line-height: 1.5rem !important;
        font-weight: 700 !important;
        color: var(--ac-text) !important;
      }
      .ac-offer-page .ac-offer-status .ac-offer-status-copy > span:last-child {
        margin-top: .5rem !important;
        font-size: .75rem !important;
        line-height: 1.25rem !important;
        font-weight: 500 !important;
        color: var(--ac-muted) !important;
        white-space: normal !important;
      }

      /* Price-rise color is enforced inside PriceTrend itself so theme CSS cannot override it. */

      /* Desktop offer: heading spans both columns; gallery thumbnails sit below the main image; responsive financing UI stays inside the offer components. */
      @media (min-width: 1280px) {
        .ac-offer-page > section > div.grid > div:first-child > header {
          width: calc(min(100vw, 1500px) - 4rem) !important;
          max-width: none !important;
        }
        .ac-offer-page > section > div.grid > div:nth-child(2) {
          margin-top: 93px !important;
        }
      }
    `}</style>
  </>;
}
