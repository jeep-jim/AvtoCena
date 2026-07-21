"use client";

import { useEffect } from "react";

function markerBefore(node: HTMLElement, name: string) {
  const selector = `[data-ac-order-marker="${name}"]`;
  const existing = document.querySelector<HTMLElement>(selector);
  if (existing) return existing;
  const marker = document.createElement("span");
  marker.hidden = true;
  marker.dataset.acOrderMarker = name;
  node.parentElement?.insertBefore(marker, node);
  return marker;
}

function nextTo(marker: HTMLElement | null, node: HTMLElement | null) {
  return Boolean(marker && node && marker.nextElementSibling === node);
}

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
      .ac-rate-chart-native>.ac-rate-point-deltas,
      .ac-rate-chart-native .ac-rate-legacy-labels,
      .ac-rate-chart-native [data-ac-rate-enhancer-label]{
        display:none!important;
      }
      .ac-budget-label{
        gap:8px!important;
        font-size:14px!important;
        line-height:1!important;
        letter-spacing:0!important;
        text-transform:none!important;
      }
      .ac-budget-label>button[aria-label="Как работает подбор по бюджету"]{
        order:-1!important;
        display:flex!important;
        width:28px!important;
        height:28px!important;
        flex:0 0 28px!important;
        border:1px solid rgba(103,113,130,.45)!important;
        border-radius:999px!important;
        background:var(--ac-surface-3)!important;
        color:var(--ac-text)!important;
        font-size:13px!important;
        line-height:1!important;
      }
      @media(max-width:1023px){
        .ac-catalog-card .ac-price-trend-arrow{
          pointer-events:none!important;
          cursor:default!important;
        }
      }
      @media(max-width:767px){
        .ac-executor-block{
          position:relative!important;
          display:block!important;
          min-height:210px!important;
          padding:20px!important;
        }
        .ac-executor-block>div:first-child{
          padding-right:112px!important;
        }
        .ac-executor-logo{
          position:absolute!important;
          top:18px!important;
          right:18px!important;
          display:block!important;
          width:96px!important;
          height:auto!important;
          min-height:0!important;
          padding:0!important;
          border:0!important;
          border-radius:0!important;
          background:transparent!important;
          box-shadow:none!important;
        }
        html[data-theme="light"] .ac-executor-logo,
        html[data-theme="dark"] .ac-executor-logo{
          background:transparent!important;
        }
        .ac-executor-logo img{
          display:block!important;
          width:100%!important;
          height:auto!important;
          max-height:52px!important;
          object-fit:contain!important;
        }
        .ac-vehicle-thumbnails{
          display:flex!important;
          flex-flow:row nowrap!important;
          grid-auto-flow:unset!important;
          grid-template-columns:none!important;
          width:calc(100% + 1rem)!important;
          max-width:calc(100% + 1rem)!important;
          overflow-x:auto!important;
          overflow-y:hidden!important;
          white-space:nowrap!important;
          scroll-snap-type:x proximity;
          -webkit-overflow-scrolling:touch;
        }
        .ac-vehicle-thumbnails>button{
          width:3.75rem!important;
          min-width:3.75rem!important;
          flex:0 0 3.75rem!important;
          scroll-snap-align:start;
        }
        .ac-catalog-pagination{
          display:flex!important;
          flex-flow:row nowrap!important;
          justify-content:flex-start!important;
          width:100%!important;
          max-width:100%!important;
          overflow-x:auto!important;
          overflow-y:hidden!important;
          white-space:nowrap!important;
          scroll-snap-type:x proximity;
          -webkit-overflow-scrolling:touch;
        }
        .ac-catalog-pagination>*{
          flex:0 0 auto!important;
          scroll-snap-align:start;
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

    const media = window.matchMedia("(max-width:1023px)");
    let frame = 0;

    const arrange = () => {
      document.querySelectorAll<HTMLElement>('button[aria-label="Как работает подбор по бюджету"]').forEach((button) => {
        button.parentElement?.classList.add("ac-budget-label");
      });

      document.querySelectorAll<HTMLElement>("[data-ac-rate-segment]").forEach((node) => node.remove());

      const home = document.querySelector<HTMLElement>(".ac-home-page");
      if (!home) return;
      const executorBlock = home.querySelector<HTMLElement>(".ac-executor-block");
      const executorGrid = executorBlock?.parentElement;
      const mobileRate = [...home.querySelectorAll<HTMLElement>(".ac-currency-rates-strip")]
        .find((node) => node.classList.contains("lg:hidden") || String(node.className).includes("lg:hidden"));
      const brandRail = home.querySelector<HTMLElement>(".ac-brand-rail");
      if (!executorGrid || !mobileRate || !brandRail) return;

      const rateMarker = markerBefore(mobileRate, "home-mobile-rate");
      const brandMarker = markerBefore(brandRail, "home-brand-original");

      if (media.matches) {
        if (executorGrid.nextElementSibling !== mobileRate) executorGrid.after(mobileRate);
        if (!nextTo(rateMarker, brandRail)) rateMarker.after(brandRail);
      } else {
        if (!nextTo(rateMarker, mobileRate)) rateMarker.after(mobileRate);
        if (!nextTo(brandMarker, brandRail)) brandMarker.after(brandRail);
      }
    };

    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(arrange);
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    media.addEventListener?.("change", schedule);
    schedule();

    return () => {
      observer.disconnect();
      media.removeEventListener?.("change", schedule);
      window.cancelAnimationFrame(frame);
      style.remove();
    };
  }, []);

  return null;
}
