"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function VehicleGallery({ images, title }: { images: string[]; title: string }) {
  const cleanImages = [...new Set(images.filter(Boolean))];
  const [activeIndex, setActiveIndex] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const didSwipe = useRef(false);
  const activeSideThumb = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setActiveIndex(0);
    setFullscreen(false);
  }, [images.join("|")]);

  useEffect(() => {
    activeSideThumb.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIndex]);

  useEffect(() => {
    if (!fullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
      if (event.key === "ArrowLeft") previous();
      if (event.key === "ArrowRight") next();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [fullscreen, cleanImages.length]);

  if (!cleanImages.length) {
    return <div className="flex h-[360px] min-w-0 max-w-full items-center justify-center overflow-hidden rounded-[2rem] bg-white/[0.045] text-sm font-black text-white/35 md:h-[520px]">Фото загружается</div>;
  }

  function previous() {
    setActiveIndex((current) => (current === 0 ? cleanImages.length - 1 : current - 1));
  }

  function next() {
    setActiveIndex((current) => (current + 1) % cleanImages.length);
  }

  function startSwipe(clientX: number) {
    touchStartX.current = clientX;
    didSwipe.current = false;
  }

  function finishSwipe(clientX: number) {
    if (touchStartX.current == null) return;
    const delta = clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) < 45 || cleanImages.length < 2) return;
    didSwipe.current = true;
    if (delta < 0) next();
    else previous();
  }

  function openFullscreen() {
    if (didSwipe.current) {
      didSwipe.current = false;
      return;
    }
    setFullscreen(true);
  }

  const image = (
    <img
      key={cleanImages[activeIndex]}
      src={cleanImages[activeIndex]}
      alt={`${title}, фото ${activeIndex + 1}`}
      className="block h-full w-full max-w-full select-none object-cover"
      loading="eager"
      decoding="async"
      fetchPriority="high"
      draggable={false}
    />
  );

  const thumbButton = (thumbnail: string, index: number, mode: "side" | "mobile") => (
    <button
      key={`${mode}-${thumbnail}-${index}`}
      ref={mode === "side" && index === activeIndex ? activeSideThumb : undefined}
      type="button"
      onClick={() => setActiveIndex(index)}
      className={`relative w-full shrink-0 cursor-pointer overflow-hidden rounded-xl transition-opacity duration-200 ${
        mode === "side" ? "h-[82px]" : "h-14 sm:h-16 md:h-24"
      } ${index === activeIndex ? "opacity-100 ring-2 ring-red-500 ring-offset-2 ring-offset-transparent" : "opacity-55 hover:opacity-90"}`}
      aria-label={`Открыть фото ${index + 1}`}
      aria-pressed={index === activeIndex}
    >
      <img src={thumbnail} alt={`${title}, миниатюра ${index + 1}`} className="pointer-events-none h-full w-full object-cover" loading="lazy" decoding="async" fetchPriority="low" draggable={false} />
      {index === activeIndex ? <span className="absolute inset-x-2 bottom-0 h-1 rounded-full bg-red-500" /> : null}
    </button>
  );

  const whiteControlStyle = { color: "#ffffff", WebkitTextFillColor: "#ffffff" } as const;

  const fullscreenGallery = fullscreen ? (
    <div
      className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/95 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Фотографии ${title}`}
      onClick={() => setFullscreen(false)}
    >
      <div className="flex max-h-[94dvh] w-full max-w-5xl flex-col items-center" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          onClick={() => setFullscreen(false)}
          className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-3xl text-white sm:right-6 sm:top-6"
          style={whiteControlStyle}
          aria-label="Закрыть галерею"
        >
          ×
        </button>

        <div
          className="flex min-h-0 w-full flex-1 items-center justify-center"
          onTouchStart={(event) => startSwipe(event.touches[0]?.clientX || 0)}
          onTouchEnd={(event) => finishSwipe(event.changedTouches[0]?.clientX || 0)}
        >
          <img
            key={`fullscreen-${cleanImages[activeIndex]}`}
            src={cleanImages[activeIndex]}
            alt={`${title}, фото ${activeIndex + 1}`}
            className="max-h-[68dvh] max-w-full select-none rounded-2xl object-contain"
            loading="eager"
            decoding="async"
            fetchPriority="high"
            draggable={false}
          />
        </div>

        {cleanImages.length > 1 ? (
          <div className="ac-hide-scrollbar mt-3 flex max-w-full gap-2 overflow-x-auto px-1 pb-1">
            {cleanImages.map((thumbnail, index) => (
              <button
                key={`fullscreen-${thumbnail}-${index}`}
                type="button"
                onClick={() => setActiveIndex(index)}
                className={`h-14 w-20 shrink-0 overflow-hidden rounded-xl transition ${index === activeIndex ? "opacity-100 ring-2 ring-red-500" : "opacity-45 hover:opacity-80"}`}
                aria-label={`Открыть фото ${index + 1}`}
                aria-pressed={index === activeIndex}
              >
                <img src={thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" fetchPriority="low" draggable={false} />
              </button>
            ))}
          </div>
        ) : null}

        <div className="mt-3 flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={previous}
            className="ac-gallery-nav flex h-11 min-w-24 items-center justify-center rounded-xl bg-white/10 px-4 text-xl font-black text-white"
            style={whiteControlStyle}
            aria-label="Предыдущее фото"
          >
            ←
          </button>
          <span className="min-w-16 text-center text-sm font-black text-white/70" style={whiteControlStyle}>{activeIndex + 1} / {cleanImages.length}</span>
          <button
            type="button"
            onClick={next}
            className="ac-gallery-nav flex h-11 min-w-24 items-center justify-center rounded-xl bg-white/10 px-4 text-xl font-black text-white"
            style={whiteControlStyle}
            aria-label="Следующее фото"
          >
            →
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <div className="min-w-0 max-w-full overflow-hidden">
        <div className={`min-w-0 ${cleanImages.length > 1 ? "md:grid md:grid-cols-[minmax(0,1fr)_104px] md:gap-3" : ""}`}>
          <button
            type="button"
            onClick={openFullscreen}
            onTouchStart={(event) => startSwipe(event.touches[0]?.clientX || 0)}
            onTouchEnd={(event) => finishSwipe(event.changedTouches[0]?.clientX || 0)}
            className="relative block h-[360px] w-full cursor-zoom-in touch-pan-y overflow-hidden rounded-[1.6rem] bg-white/[0.04] md:h-[520px] md:rounded-[2rem]"
            aria-label="Открыть фотографии автомобиля"
          >
            {image}
            <div className="ac-on-image absolute bottom-3 right-3 rounded-full bg-black/55 px-3 py-1 text-xs font-black text-white/85 backdrop-blur">
              {activeIndex + 1} / {cleanImages.length}
            </div>
          </button>

          {cleanImages.length > 1 ? (
            <div className="ac-vehicle-side-thumbnails ac-hide-scrollbar hidden h-[520px] min-w-0 flex-col gap-2 overflow-y-auto py-1 pr-1 md:flex">
              {cleanImages.map((thumbnail, index) => thumbButton(thumbnail, index, "side"))}
            </div>
          ) : null}
        </div>

        {cleanImages.length > 1 ? (
          <div className="ac-vehicle-thumbnails ac-hide-scrollbar -mr-4 mt-3 grid max-w-[calc(100%+1rem)] grid-flow-col auto-cols-[3.75rem] gap-2 overflow-x-auto p-1 pb-2 pr-4 sm:auto-cols-[4.5rem] md:hidden">
            {cleanImages.map((thumbnail, index) => thumbButton(thumbnail, index, "mobile"))}
          </div>
        ) : null}
      </div>

      {fullscreenGallery && typeof document !== "undefined" ? createPortal(fullscreenGallery, document.body) : null}
    </>
  );
}
