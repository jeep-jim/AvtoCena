"use client";

import { useEffect } from "react";

const SVG_NS = "http://www.w3.org/2000/svg";
const DISCLAIMER = "Итоговую цену подтверждает менеджер на момент оплаты.";

function numberAttribute(element: SVGElement, name: string) {
  const value = Number(element.getAttribute(name));
  return Number.isFinite(value) ? value : 0;
}

function polishChart(svg: SVGSVGElement) {
  const circles = [...svg.querySelectorAll<SVGCircleElement>("circle.cursor-pointer")];
  if (circles.length < 2) return;

  const points = circles.map((circle) => ({
    x: numberAttribute(circle, "cx"),
    y: numberAttribute(circle, "cy"),
  }));
  const signature = points.map((point) => `${point.x}:${point.y}`).join("|");
  const baseLine = svg.querySelector<SVGPathElement>('path[fill="none"][stroke-width="2.6"]');
  if (baseLine) baseLine.style.opacity = "0";
  const existingSegments = svg.querySelectorAll("[data-ac-rate-segment]");
  if (svg.dataset.acSegmentSignature === signature && existingSegments.length === points.length - 1) return;

  existingSegments.forEach((node) => node.remove());

  const fragment = document.createDocumentFragment();
  points.slice(1).forEach((point, index) => {
    const previous = points[index];
    const deltaY = point.y - previous.y;
    const segment = document.createElementNS(SVG_NS, "line");
    segment.setAttribute("data-ac-rate-segment", "true");
    segment.setAttribute("x1", String(previous.x));
    segment.setAttribute("y1", String(previous.y));
    segment.setAttribute("x2", String(point.x));
    segment.setAttribute("y2", String(point.y));
    segment.setAttribute("stroke", deltaY > 0.01 ? "#31b765" : deltaY < -0.01 ? "#ef3340" : "#8a93a3");
    segment.setAttribute("stroke-width", "2.6");
    segment.setAttribute("stroke-linecap", "round");
    segment.setAttribute("stroke-linejoin", "round");
    segment.setAttribute("pointer-events", "none");
    fragment.appendChild(segment);
  });

  svg.insertBefore(fragment, circles[0]);
  svg.dataset.acSegmentSignature = signature;
}

function polishDisclaimers() {
  for (const node of document.querySelectorAll<HTMLElement>(".ac-rate-sheet div, .ac-price-trend-popover div")) {
    if (node.children.length === 0 && node.textContent?.trim() === DISCLAIMER) {
      node.textContent = `* ${DISCLAIMER}`;
    }
  }
}

function polishCurrencyUi() {
  document.querySelectorAll<SVGSVGElement>('svg[aria-label^="Изменение курса "]').forEach(polishChart);
  polishDisclaimers();
}

export function CurrencyChartEnhancer() {
  useEffect(() => {
    const style = document.createElement("style");
    style.id = "ac-currency-chart-polish";
    style.textContent = `
      .ac-home-page .ac-executor-block,
      .ac-currency-rates-strip{
        background:var(--ac-surface)!important;
        border:0!important;
        outline:0!important;
        box-shadow:0 12px 34px rgba(0,0,0,.12)!important;
      }
      .ac-home-page .ac-executor-logo{
        background:var(--ac-surface-2)!important;
        border:0!important;
        outline:0!important;
      }
      html[data-theme="light"] .ac-home-page .ac-executor-block,
      html[data-theme="light"] .ac-currency-rates-strip{
        background:var(--ac-surface)!important;
        border:0!important;
        outline:0!important;
        box-shadow:0 12px 34px rgba(38,43,57,.09)!important;
      }
      html[data-theme="light"] .ac-home-page .ac-executor-logo{
        background:var(--ac-surface-2)!important;
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

    let frame = 0;
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(polishCurrencyUi);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["cx", "cy", "aria-label"] });
    schedule();

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      style.remove();
    };
  }, []);

  return null;
}
