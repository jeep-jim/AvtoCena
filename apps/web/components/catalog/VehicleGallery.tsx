"use client";

import { useEffect, useState } from "react";

export function VehicleGallery({ images, title }: { images: string[]; title: string }) {
  const cleanImages = [...new Set(images.filter(Boolean))];
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex(0);
  }, [images.join("|")]);

  if (!cleanImages.length) {
    return <div className="flex h-[360px] min-w-0 max-w-full items-center justify-center overflow-hidden rounded-[2rem] bg-white/[0.045] text-sm font-black text-white/35 md:h-[520px]">Фото загружается</div>;
  }

  function previous() {
    setActiveIndex((current) => (current === 0 ? cleanImages.length - 1 : current - 1));
  }

  function next() {
    setActiveIndex((current) => (current + 1) % cleanImages.length);
  }

  return (
    <div className="min-w-0 max-w-full overflow-hidden">
      <div className="relative min-w-0 max-w-full overflow-hidden rounded-[1.6rem] bg-white/[0.04] md:rounded-[2rem]">
        <button type="button" onClick={cleanImages.length > 1 ? next : undefined} className={`block w-full ${cleanImages.length > 1 ? "cursor-pointer" : "cursor-default"}`} aria-label={cleanImages.length > 1 ? "Показать следующее фото" : undefined}>
          <img key={cleanImages[activeIndex]} src={cleanImages[activeIndex]} alt={`${title}, фото ${activeIndex + 1}`} className="block h-[360px] max-w-full w-full object-cover md:h-[520px]" />
        </button>
        {cleanImages.length > 1 ? (
          <>
            <button type="button" onClick={previous} className="ac-on-image absolute left-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl bg-black/55 text-2xl text-white backdrop-blur hover:bg-black/75" aria-label="Предыдущее фото">‹</button>
            <button type="button" onClick={next} className="ac-on-image absolute right-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl bg-black/55 text-2xl text-white backdrop-blur hover:bg-black/75" aria-label="Следующее фото">›</button>
            <div className="ac-on-image absolute bottom-3 right-3 rounded-full bg-black/55 px-3 py-1 text-xs font-black text-white/85 backdrop-blur">{activeIndex + 1} / {cleanImages.length}</div>
          </>
        ) : null}
      </div>

      {cleanImages.length > 1 ? (
        <div className="ac-hide-scrollbar mt-3 flex max-w-full gap-3 overflow-x-auto pb-2 pr-1">
          {cleanImages.map((image, index) => (
            <button
              key={`${image}-${index}`}
              type="button"
              onClick={() => setActiveIndex(index)}
              className={`relative z-10 h-20 w-28 shrink-0 cursor-pointer overflow-hidden rounded-2xl transition md:h-28 md:w-40 ${index === activeIndex ? "ring-2 ring-red-400 opacity-100" : "opacity-68 ring-1 ring-white/8 hover:opacity-100"}`}
              aria-label={`Открыть фото ${index + 1}`}
              aria-pressed={index === activeIndex}
            >
              <img src={image} alt={`${title}, миниатюра ${index + 1}`} className="pointer-events-none h-full w-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
