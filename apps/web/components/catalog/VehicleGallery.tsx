"use client";

import { useEffect, useState } from "react";

export function VehicleGallery({ images, title }: { images: string[]; title: string }) {
  const cleanImages = images.filter(Boolean);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex(0);
  }, [images.join("|")]);

  if (!cleanImages.length) {
    return <div className="flex h-[360px] items-center justify-center rounded-[2rem] bg-white/[0.045] text-sm font-black text-white/35 md:h-[520px]">Фото загружается</div>;
  }

  function previous() {
    setActiveIndex((current) => (current === 0 ? cleanImages.length - 1 : current - 1));
  }

  function next() {
    setActiveIndex((current) => (current + 1) % cleanImages.length);
  }

  return (
    <div>
      <div className="relative overflow-hidden rounded-[1.6rem] bg-white/[0.04] md:rounded-[2rem]">
        <img src={cleanImages[activeIndex]} alt={`${title}, фото ${activeIndex + 1}`} className="h-[360px] w-full object-cover md:h-[520px]" />
        {cleanImages.length > 1 ? (
          <>
            <button type="button" onClick={previous} className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-2xl text-white backdrop-blur hover:bg-black/75" aria-label="Предыдущее фото">‹</button>
            <button type="button" onClick={next} className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-2xl text-white backdrop-blur hover:bg-black/75" aria-label="Следующее фото">›</button>
            <div className="absolute bottom-3 right-3 rounded-full bg-black/55 px-3 py-1 text-xs font-black text-white/85 backdrop-blur">{activeIndex + 1} / {cleanImages.length}</div>
          </>
        ) : null}
      </div>

      {cleanImages.length > 1 ? (
        <div className="ac-hide-scrollbar mt-3 flex gap-3 overflow-x-auto pb-1">
          {cleanImages.map((image, index) => (
            <button
              key={`${image}-${index}`}
              type="button"
              onClick={() => setActiveIndex(index)}
              className={`h-24 w-32 shrink-0 overflow-hidden rounded-2xl border transition md:h-28 md:w-40 ${index === activeIndex ? "border-red-400" : "border-white/10 opacity-75 hover:opacity-100"}`}
              aria-label={`Открыть фото ${index + 1}`}
            >
              <img src={image} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
