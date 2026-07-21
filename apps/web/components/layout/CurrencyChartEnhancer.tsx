"use client";

import { useEffect } from "react";

export function CurrencyChartEnhancer() {
  useEffect(() => {
    const style = document.createElement("style");
    style.id = "ac-currency-chart-polish";
    style.textContent = `
      .ac-executor-block,
      .ac-currency-rates-strip{
        background:var(--ac-surface)!important;
        border:0!important;
        outline:0!important;
        box-shadow:none!important;
      }
      .ac-executor-logo{
        background:var(--ac-surface-2)!important;
        border:0!important;
        outline:0!important;
      }
      html[data-theme="light"] .ac-executor-block,
      html[data-theme="light"] .ac-currency-rates-strip{
        background:var(--ac-surface)!important;
        border:0!important;
        box-shadow:none!important;
      }
      html[data-theme="light"] .ac-executor-logo{
        background:var(--ac-surface-2)!important;
      }
      .ac-market-all-link{
        display:inline-flex!important;
        min-height:38px!important;
        align-items:center!important;
        justify-content:center!important;
        border:0!important;
        border-radius:12px!important;
        background:rgba(255,255,255,.055)!important;
        color:var(--ac-text)!important;
        padding:8px 12px!important;
        box-shadow:none!important;
        text-decoration:none!important;
      }
      html[data-theme="light"] .ac-market-all-link{
        background:var(--ac-surface)!important;
        color:var(--ac-text)!important;
        box-shadow:0 7px 20px rgba(38,43,57,.08)!important;
      }
      @media(max-width:1023px){
        .ac-catalog-card .ac-price-trend-arrow{
          pointer-events:none!important;
          cursor:default!important;
        }
      }
      @media(min-width:1024px){
        html body .ac-home-page>div.mx-auto{
          display:block!important;
          grid-template-columns:none!important;
          column-gap:0!important;
        }
      }
    `;
    document.getElementById(style.id)?.remove();
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  return null;
}
