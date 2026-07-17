"use client";

import { useEffect, useRef, useState } from "react";

export function BuyerGallery({ images }: { images: string[] }) {
  const [active, setActive] = useState<number | null>(null);
  const rail = useRef<HTMLDivElement>(null);
  const swipeStart = useRef<number | null>(null);

  useEffect(() => {
    let frame = 0;
    let previous = performance.now();
    const animate = (now: number) => {
      const node = rail.current;
      const delta = Math.min(40, now - previous);
      previous = now;
      if (node) {
        node.scrollLeft += delta * 0.026;
        const loopWidth = node.scrollWidth / 2;
        if (loopWidth > 0 && node.scrollLeft >= loopWidth) node.scrollLeft -= loopWidth;
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (active === null) return;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActive(null);
      if (event.key === "ArrowLeft") setActive((active - 1 + images.length) % images.length);
      if (event.key === "ArrowRight") setActive((active + 1) % images.length);
    };
    addEventListener("keydown", keydown);
    return () => { document.body.style.overflow = old; removeEventListener("keydown", keydown); };
  }, [active, images.length]);

  const previous = () => setActive((current) => current === null ? 0 : (current - 1 + images.length) % images.length);
  const next = () => setActive((current) => current === null ? 0 : (current + 1) % images.length);
  const finishSwipe = (clientX: number) => {
    if (swipeStart.current === null) return;
    const delta = clientX - swipeStart.current;
    swipeStart.current = null;
    if (Math.abs(delta) >= 45) delta < 0 ? next() : previous();
  };

  return <section className="mt-8 overflow-hidden">
    <h2 className="whitespace-nowrap text-[clamp(18px,5.5vw,24px)] font-black leading-none md:text-5xl">Те, кто узнали — уже ездят!</h2>
    <div ref={rail} className="ac-buyers-rail ac-hide-scrollbar mt-4 flex gap-3 overflow-x-auto pb-2">
      {[...images, ...images].map((src, index) => <button key={`${src}-${index}`} type="button" onClick={() => setActive(index % images.length)} className="h-32 w-44 shrink-0 overflow-hidden rounded-2xl sm:h-40 sm:w-56 md:h-44 md:w-64"><img src={src} alt={`Клиент TopAvto ${(index % images.length) + 1}`} className="h-full w-full object-cover" /></button>)}
    </div>
    {active !== null ? <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/95 p-3 sm:p-6" onClick={() => setActive(null)} role="dialog" aria-modal="true" aria-label="Фотографии клиентов TopAvto"><div className="flex max-h-[94dvh] w-full max-w-5xl flex-col items-center" onClick={(event) => event.stopPropagation()}><button type="button" onClick={() => setActive(null)} className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-3xl text-white sm:right-6 sm:top-6" aria-label="Закрыть">×</button><div className="flex min-h-0 w-full flex-1 items-center justify-center" onTouchStart={(event) => { swipeStart.current = event.touches[0]?.clientX || 0; }} onTouchEnd={(event) => finishSwipe(event.changedTouches[0]?.clientX || 0)}><img src={images[active]} alt={`Клиент TopAvto ${active + 1}`} className="max-h-[68dvh] max-w-full select-none rounded-2xl object-contain" draggable={false} /></div><div className="ac-hide-scrollbar mt-3 flex max-w-full gap-2 overflow-x-auto px-1 pb-1">{images.map((src, index) => <button key={`buyer-thumb-${src}`} type="button" onClick={() => setActive(index)} className={`h-14 w-20 shrink-0 overflow-hidden rounded-xl transition ${index === active ? "opacity-100 ring-2 ring-red-500" : "opacity-45 hover:opacity-80"}`}><img src={src} alt="" className="h-full w-full object-cover" /></button>)}</div><div className="mt-3 flex items-center justify-center gap-4"><button type="button" onClick={previous} className="flex h-11 min-w-24 items-center justify-center rounded-xl bg-white/10 px-4 text-xl font-black text-white" aria-label="Предыдущее фото">←</button><span className="min-w-16 text-center text-sm font-black text-white/70">{active + 1} / {images.length}</span><button type="button" onClick={next} className="flex h-11 min-w-24 items-center justify-center rounded-xl bg-white/10 px-4 text-xl font-black text-white" aria-label="Следующее фото">→</button></div></div></div> : null}
  </section>;
}
