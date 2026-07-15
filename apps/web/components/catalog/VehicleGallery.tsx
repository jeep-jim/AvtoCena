"use client";

import { useEffect, useState } from "react";

export function VehicleGallery({ images, title }: { images: string[]; title: string }) {
  const cleanImages = images.filter(Boolean);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex(0);
  }, [images.join("|")]);

  if (!cleanImages.length) {
    return <div className="aspect-square min-w-0 max-w-full overflow-hidden rounded-[1.6rem] bg-white/[0.045] text-sm font-black text-white/35 md:aspect-[4/3] md:rounded-[2rem]"><div className="flex h-full items-center justify-center">Фото загружается</div></div>;
  }

  function next() {
    if (cleanImages.length > 1) setActiveIndex((current) => (current + 1) % cleanImages.length);
  }

  return (
    <div className="min-w-0 max-w-full overflow-hidden">
      <button type="button" onClick={next} className="relative block aspect-square w-full min-w-0 max-w-full overflow-hidden rounded-[1.6rem] bg-white/[0.04] text-left md:aspect-[4/3] md:rounded-[2rem]" aria-label={cleanImages.length > 1 ? "Показать следующее фото" : title}>
        <img src={cleanImages[activeIndex]} alt={`${title}, фото ${activeIndex + 1}`} className="block h-full w-full object-cover object-center" />
        {cleanImages.length > 1 ? <div className="ac-on-image absolute bottom-3 right-3 rounded-full bg-black/55 px-3 py-1 text-xs font-black text-white/85 backdrop-blur">{activeIndex + 1} / {cleanImages.length}</div> : null}
      </button>

      {cleanImages.length > 1 ? (
        <div className="ac-hide-scrollbar mt-3 flex max-w-full gap-3 overflow-x-auto pb-1 pr-1">
          {cleanImages.map((image, index) => (
            <button key={`${image}-${index}`} type="button" onClick={() => setActiveIndex(index)} className={`h-20 w-28 shrink-0 overflow-hidden rounded-2xl transition md:h-28 md:w-40 ${index === activeIndex ? "ring-2 ring-red-400" : "opacity-68 hover:opacity-100"}`} aria-label={`Открыть фото ${index + 1}`}>
              <img src={image} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
