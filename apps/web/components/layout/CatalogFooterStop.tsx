"use client";

import {useEffect, useRef, useState} from "react";
import {ChevronDown} from "lucide-react";
import "./CatalogFooterStop.css";

/** Stop one mobile gesture at pagination; the next gesture can enter the footer. */
export function CatalogFooterStop() {
  const [visible,setVisible] = useState(false);
  const tapStart = useRef<{x:number;y:number}|null>(null);
  const marker = useRef<HTMLDivElement>(null);
  const releaseStop = useRef<() => void>(() => {});
  useEffect(() => {
    const root = document.documentElement;
    const mobile = window.matchMedia("(max-width: 767px) and (pointer: coarse)");
    let armed = false;
    let boundary = Infinity;
    const release = () => {setVisible(false); armed = false; root.classList.remove("ac-catalog-footer-stop");};
    releaseStop.current = release;
    // Geometry changes on layout/resize, not on every animation frame of a fling.
    const measure = () => {
      boundary = marker.current ? marker.current.getBoundingClientRect().bottom + window.scrollY - window.innerHeight : Infinity;
    };
    const stop = () => {
      if (!armed || !mobile.matches) return;
      if (boundary > 0 && window.scrollY >= boundary-120) root.classList.add("ac-catalog-footer-stop");
      if (boundary > 0 && Math.abs(window.scrollY-boundary) <= 3) setVisible(true);
      else setVisible(false);
    };
    const start = (event: TouchEvent) => {
      const target = event.target as Element;
      // Keep the arrow visible until its tap produces a click.
      if (marker.current?.contains(target) && target.closest("button")) {armed=false;root.classList.remove("ac-catalog-footer-stop");return;}
      release();
      if (!mobile.matches || event.touches.length !== 1 || !marker.current) return;
      // Filters, galleries and other nested scrollers keep their own gestures.
      for (let element: Element | null = target; element && element !== document.body; element = element.parentElement) {
        if (element.matches('input, textarea, select, [role="dialog"], [aria-modal="true"]')) return;
        const style = getComputedStyle(element);
        if (/auto|scroll/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1) return;
        if (/auto|scroll/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1) return;
      }
      // Already at or past the line: this gesture is permission to enter footer.
      measure();
      const bottom = boundary + window.innerHeight - window.scrollY;
      if (bottom > window.innerHeight + 8) armed = true;
    };
    const click = (event: MouseEvent) => {if(!marker.current?.contains(event.target as Node))release();};
    const resize = () => {measure();};
    const mediaChange = () => {release(); resize();};
    const geometry = new ResizeObserver(measure);
    geometry.observe(document.body);
    if (marker.current) geometry.observe(marker.current);
    // Native scroll snapping stops the compositor's fling once. Repeated
    // scrollTo corrections in a scroll handler fight momentum and cause jitter.
    resize();
    document.addEventListener("touchstart", start, {passive:true});
    window.addEventListener("scroll", stop, {passive:true});
    window.addEventListener("resize", resize, {passive:true});
    document.addEventListener("keydown", release);
    document.addEventListener("click", click, true);
    window.addEventListener("popstate", release);
    mobile.addEventListener("change", mediaChange);
    return () => {
      release();
      document.removeEventListener("touchstart", start);
      window.removeEventListener("scroll", stop);
      window.removeEventListener("resize", resize);
      geometry.disconnect();
      document.removeEventListener("keydown", release);
      document.removeEventListener("click", click, true);
      window.removeEventListener("popstate", release);
      mobile.removeEventListener("change", mediaChange);
      releaseStop.current = () => {};
    };
  }, []);
  const openFooter = () => {
    releaseStop.current();
    marker.current?.nextElementSibling?.scrollIntoView({block:"start", behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth"});
  };
  return <div ref={marker} className="ac-catalog-footer-boundary">
    <button type="button" style={{visibility:visible ? "visible" : "hidden"}} tabIndex={visible ? 0 : -1} aria-hidden={!visible} aria-label="Перейти к информации внизу страницы"
      onTouchStart={event=>{const t=event.touches[0];tapStart.current=t?{x:t.clientX,y:t.clientY}:null;}}
      onTouchEnd={event=>{const t=event.changedTouches[0],start=tapStart.current;tapStart.current=null;if(t&&start&&Math.hypot(t.clientX-start.x,t.clientY-start.y)<12){event.preventDefault();openFooter();}}}
      onClick={openFooter}><ChevronDown size={28} aria-hidden="true" /></button>
  </div>;
}
