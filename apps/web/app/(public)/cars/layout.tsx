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
      }
      .ac-offer-page h1::-webkit-scrollbar {
        display: none;
      }

      /* On desktop the offer heading may use both columns, while the price panel starts level with the main photo. */
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
