"use client";

import {useEffect, useRef} from "react";
import {ChevronDown} from "lucide-react";
import "./CatalogFooterStop.css";

/** One native momentum stop before the footer; the next gesture can pass it. */
export function CatalogFooterStop() {
  const marker = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = document.documentElement;
    const mobile = window.matchMedia("(max-width: 767px) and (pointer: coarse)");
    const release = () => root.classList.remove("ac-catalog-footer-stop");
    const start = (event: TouchEvent) => {
      release();
      if (!mobile.matches || event.touches.length !== 1 || !marker.current) return;
      const target = event.target as Element;
      // Filters, galleries and other nested scrollers keep their own gestures.
      for (let element: Element | null = target; element && element !== document.body; element = element.parentElement) {
        if (element.matches('input, textarea, select, [role="dialog"], [aria-modal="true"]')) return;
        const style = getComputedStyle(element);
        if (/auto|scroll/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1) return;
        if (/auto|scroll/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1) return;
      }
      // Already at or past the line: this gesture is permission to enter footer.
      const bottom = marker.current.getBoundingClientRect().bottom;
      if (bottom > window.innerHeight + 8) root.classList.add("ac-catalog-footer-stop");
    };
    document.addEventListener("touchstart", start, {passive:true});
    document.addEventListener("keydown", release);
    document.addEventListener("click", release, true);
    window.addEventListener("popstate", release);
    window.addEventListener("resize", release);
    return () => {
      release();
      document.removeEventListener("touchstart", start);
      document.removeEventListener("keydown", release);
      document.removeEventListener("click", release, true);
      window.removeEventListener("popstate", release);
      window.removeEventListener("resize", release);
    };
  }, []);
  return <div ref={marker} className="ac-catalog-footer-boundary">
    <button type="button" aria-label="Перейти к информации внизу страницы" onClick={() => {
      document.documentElement.classList.remove("ac-catalog-footer-stop");
      marker.current?.nextElementSibling?.scrollIntoView({block:"start", behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth"});
    }}><ChevronDown size={28} aria-hidden="true" /></button>
  </div>;
}
