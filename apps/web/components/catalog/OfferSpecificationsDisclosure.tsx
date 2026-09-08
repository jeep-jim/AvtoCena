"use client";

import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, CarFront, X } from "lucide-react";
import { OfferAllSpecifications } from "./OfferAllSpecifications";
import { useTapActivation } from "./useTapActivation";
import type { SourceSpecificationSnapshot } from "../../lib/catalog/source-specifications";

type Props = { groups: SourceSpecificationSnapshot["groups"]; title: string; mode: "desktop" | "mobile"; sourceUrl?: string };

export function OfferSpecificationsDisclosure({ groups, title, mode, sourceUrl }: Props) {
  const [open, setOpen] = useState(false);
  const [dragY, setDragY] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ id: number; y: number; lastY: number; at: number } | null>(null);
  const headingId = useId();
  const tap = useTapActivation();
  const close = () => { setOpen(false); setDragY(0); drag.current = null; };

  useEffect(() => {
    if (!open || mode !== "mobile") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const root = document.documentElement;
    const body = document.body;
    const previous = { rootOverflow: root.style.overflow, bodyOverflow: body.style.overflow, overscroll: body.style.overscrollBehavior };
    root.style.overflow = body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
    dialog.showModal();
    const desktop = window.matchMedia("(min-width: 1280px)");
    const resize = () => { if (desktop.matches) close(); };
    desktop.addEventListener("change", resize);
    return () => {
      dialog.close();
      root.style.overflow = previous.rootOverflow;
      body.style.overflow = previous.bodyOverflow;
      body.style.overscrollBehavior = previous.overscroll;
      desktop.removeEventListener("change", resize);
      triggerRef.current?.focus({ preventScroll: true });
    };
  }, [open, mode]);

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0) || (event.target as HTMLElement).closest("button")) return;
    drag.current = { id: event.pointerId, y: event.clientY, lastY: event.clientY, at: performance.now() };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current.lastY = event.clientY;
    setDragY(Math.max(0, event.clientY - drag.current.y));
  };
  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    const distance = Math.max(0, state.lastY - state.y);
    const elapsed = Math.max(1, performance.now() - state.at);
    drag.current = null;
    if (distance >= 95 || (distance >= 24 && distance / elapsed > .65)) { event.preventDefault(); event.stopPropagation(); close(); }
    else setDragY(0);
  };
  const content = <OfferAllSpecifications groups={groups} showHeading={false} sourceUrl={sourceUrl} />;

  if (mode === "desktop") return <details className="group/specs mt-6 hidden min-w-0 xl:block">
    <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl bg-[var(--ac-surface-2)] px-4 py-3.5 text-sm font-bold text-[var(--ac-text)] outline-none focus-visible:ring-2 focus-visible:ring-red-400 [&::-webkit-details-marker]:hidden">
      <span className="flex items-center gap-2.5"><CarFront className="h-5 w-5 text-[var(--ac-muted)]" aria-hidden="true" />Все характеристики</span>
      <ChevronDown className="h-5 w-5 transition-transform group-open/specs:rotate-180" aria-hidden="true" />
    </summary>
    <div className="px-1 pb-5 pt-4">{content}</div>
  </details>;

  return <>
    <button ref={triggerRef} type="button" {...tap} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}
      className="ac-offer-spec-tile flex min-h-12 w-full items-center justify-between gap-3 rounded-[1.1rem] bg-[var(--ac-surface-2)] px-4 text-left text-sm font-bold text-[var(--ac-text)] outline-none transition hover:bg-[var(--ac-surface-2)] focus-visible:ring-2 focus-visible:ring-red-400 xl:hidden">
      <span className="flex items-center gap-2.5"><CarFront className="h-4 w-4 text-[var(--ac-muted)]" aria-hidden="true" />Все характеристики</span><ChevronRight className="h-4 w-4" aria-hidden="true" />
    </button>
    {open && typeof document !== "undefined" ? createPortal(<dialog ref={dialogRef} aria-labelledby={headingId} onCancel={(event) => { event.preventDefault(); close(); }}
      className="fixed inset-0 m-0 h-[100dvh] max-h-none w-screen max-w-none overflow-hidden border-0 bg-transparent p-0 text-[var(--ac-text)] outline-none backdrop:bg-black/65 backdrop:backdrop-blur-md">
      <div className="flex h-full items-end" {...tap} onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
        <div className="relative flex max-h-[90dvh] w-full min-w-0 flex-col rounded-t-[30px] bg-[var(--ac-surface)] shadow-[0_-24px_80px_rgba(0,0,0,.3)] motion-safe:transition-transform motion-safe:duration-150"
          style={{ transform: `translateY(${dragY}px)`, transitionDuration: drag.current ? "0ms" : undefined }}>
          <div className="relative shrink-0 touch-none border-b border-[var(--ac-border)] px-5 pb-4 pt-5" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={() => { drag.current = null; setDragY(0); }}>
            <div className="absolute -top-8 left-1/2 flex h-8 w-24 -translate-x-1/2 items-center justify-center" aria-hidden="true"><span className="h-1.5 w-12 rounded-full bg-white/85" /></div>
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-xs font-semibold text-[#ef3340]">{title}</p><h2 id={headingId} className="mt-1 text-xl font-black">Все характеристики</h2></div>
              <button type="button" autoFocus onClick={close} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--ac-surface-2)] outline-none focus-visible:ring-2 focus-visible:ring-red-400" aria-label="Закрыть характеристики"><X className="h-5 w-5" aria-hidden="true" /></button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-4">{content}</div>
        </div>
      </div>
    </dialog>, document.body) : null}
  </>;
}
