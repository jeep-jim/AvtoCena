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
    `}</style>
  </>;
}
