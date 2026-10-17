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
    let lastY = 0;
    const release = () => {setVisible(false); armed = false; root.classList.remove("ac-catalog-footer-stop");};
    releaseStop.current = release;
    const limit = () => marker.current ? marker.current.getBoundingClientRect().bottom + window.scrollY - window.innerHeight : Infinity;
    const stop = () => {
      if (!armed || !mobile.matches) return;
      const boundary = limit();
      if (boundary > 0 && window.scrollY >= boundary - 1) {setVisible(true); if(window.scrollY > boundary) window.scrollTo({top:boundary, behavior:"instant"});}
      else setVisible(false);
    };
    const move = (event: TouchEvent) => {
      if (event.touches.length !== 1) {release(); return;}
      const nextY = event.touches[0].clientY;
      const delta = lastY - nextY;
      lastY = nextY;
      if (delta < 0) {release(); return;}
      if (!armed || delta === 0) return;
      const boundary = limit();
      if (boundary > 0 && window.scrollY + delta >= boundary) {
        setVisible(true);
        if (event.cancelable) event.preventDefault();
        window.scrollTo({top:boundary, behavior:"instant"});
      }
    };
    const start = (event: TouchEvent) => {
      const target = event.target as Element;
      // Keep the arrow visible until its tap produces a click.
      if (marker.current?.contains(target) && target.closest("button")) {armed=false;root.classList.remove("ac-catalog-footer-stop");lastY=event.touches[0]?.clientY||0;return;}
      release();
      if (!mobile.matches || event.touches.length !== 1 || !marker.current) return;
      lastY = event.touches[0].clientY;
      // Filters, galleries and other nested scrollers keep their own gestures.
      for (let element: Element | null = target; element && element !== document.body; element = element.parentElement) {
        if (element.matches('input, textarea, select, [role="dialog"], [aria-modal="true"]')) return;
        const style = getComputedStyle(element);
        if (/auto|scroll/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1) return;
        if (/auto|scroll/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1) return;
      }
      // Already at or past the line: this gesture is permission to enter footer.
      const bottom = marker.current.getBoundingClientRect().bottom;
      if (bottom > window.innerHeight + 8) {armed = true; root.classList.add("ac-catalog-footer-stop");}
    };
    const click = (event: MouseEvent) => {if(!marker.current?.contains(event.target as Node))release();};
    document.addEventListener("touchstart", start, {passive:true});
    document.addEventListener("touchmove", move, {passive:false});
    window.addEventListener("scroll", stop, {passive:true});
    document.addEventListener("keydown", release);
    document.addEventListener("click", click, true);
    window.addEventListener("popstate", release);
    mobile.addEventListener("change", release);
    return () => {
      release();
      document.removeEventListener("touchstart", start);
      document.removeEventListener("touchmove", move);
      window.removeEventListener("scroll", stop);
      document.removeEventListener("keydown", release);
      document.removeEventListener("click", click, true);
      window.removeEventListener("popstate", release);
      mobile.removeEventListener("change", release);
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
