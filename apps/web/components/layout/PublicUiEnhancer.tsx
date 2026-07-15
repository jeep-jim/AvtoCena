"use client";

import { useEffect, useState } from "react";

type Preview = {
  src: string;
  alt: string;
};

export function PublicUiEnhancer() {
  const [preview, setPreview] = useState<Preview | null>(null);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const image = target?.closest<HTMLImageElement>(".ac-offer-panel img");
      if (!image || image.closest("button") || !image.currentSrc) return;
      event.preventDefault();
      setPreview({ src: image.currentSrc, alt: image.alt || "Фотография автомобиля" });
    };

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  useEffect(() => {
    if (!preview) return;
    const previousOverflow = document.body.style.overflow;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(null);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", close);
    };
  }, [preview]);

  if (!preview) return null;

  return (
    <div className="ac-image-lightbox fixed inset-0 z-[10050] flex items-center justify-center bg-black/90 p-3 backdrop-blur-md sm:p-8" role="dialog" aria-modal="true" aria-label="Просмотр фотографии" onClick={() => setPreview(null)}>
      <img src={preview.src} alt={preview.alt} className="max-h-full max-w-full select-none object-contain" onClick={(event) => event.stopPropagation()} />
      <button type="button" onClick={() => setPreview(null)} className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur sm:right-6 sm:top-6" aria-label="Закрыть фотографию">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M3 3L15 15M15 3L3 15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
      </button>
    </div>
  );
}
