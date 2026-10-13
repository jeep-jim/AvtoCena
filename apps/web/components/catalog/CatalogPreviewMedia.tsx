"use client";

import { useEffect, useRef, useState, type ReactNode, type PointerEvent } from "react";
import { CatalogCover } from "./CatalogCover";
import { DESKTOP_PHOTO_PREVIEW, previewPhotoIndex, previewPhotos } from "../../lib/catalog/preview-photos";

const cache = new Map<string, {at: number; images: string[]}>();

/** The list remains cover-only until the visitor actually hovers this card. */
export function CatalogPreviewMedia({offerId, src, images, alt, eager = false, className, children}: {
  offerId: string; src: string; images: string[]; alt: string; eager?: boolean; className?: string; children?: ReactNode;
}) {
  const [extra, setExtra] = useState<string[]>([]);
  const [position, setPosition] = useState<number | null>(null);
  const [ready, setReady] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef<AbortController | null>(null);
  const photos = previewPhotos(src, extra.length ? extra : images);
  const active = position === null ? 0 : previewPhotoIndex(position, photos.length);
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    request.current?.abort();
    request.current = null;
  };
  useEffect(() => {
    setExtra([]); setReady([]); setPosition(null);
    return stop;
  }, [offerId, src]);
  useEffect(() => {
    const media = window.matchMedia(DESKTOP_PHOTO_PREVIEW);
    const reset = () => { if (!media.matches) { stop(); setPosition(null); } };
    media.addEventListener("change", reset);
    return () => media.removeEventListener("change", reset);
  }, []);
  function move(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse" || !window.matchMedia(DESKTOP_PHOTO_PREVIEW).matches) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width) setPosition(Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)));
  }
  function enter(event: PointerEvent<HTMLDivElement>) {
    move(event);
    if (event.pointerType !== "mouse" || !window.matchMedia(DESKTOP_PHOTO_PREVIEW).matches || !offerId || photos.length >= 5) return;
    const key = `${offerId}|${src}`;
    const saved = cache.get(key);
    if (saved && Date.now() - saved.at < 300_000) { setExtra(saved.images); return; }
    stop();
    timer.current = setTimeout(async () => {
      const controller = new AbortController();
      request.current = controller;
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetch(`/api/catalog/offer/${encodeURIComponent(offerId)}/preview-photos`, {signal:controller.signal});
        if (!response.ok) return;
        const result = await response.json();
        if (controller.signal.aborted || !Array.isArray(result.images)) return;
        const urls = previewPhotos(src, result.images.filter((url: unknown): url is string => typeof url === "string"));
        if (cache.size >= 64) cache.delete(cache.keys().next().value!);
        cache.set(key, {at:Date.now(), images:urls});
        setExtra(urls);
      } catch { /* Keep the working cover if extra photos cannot be read. */ }
      finally { clearTimeout(timeout); if (request.current === controller) request.current = null; }
    }, 180);
  }
  return <div className={className} onPointerEnter={enter} onPointerMove={move} onPointerLeave={() => {stop(); setPosition(null);}} data-preview-photo={active + 1}>
    {src ? <CatalogCover src={src} alt={alt} eager={eager} /> : <div className="flex h-full items-center justify-center text-xs text-[var(--ac-muted)]">Фото загружается</div>}
    {position !== null && photos.slice(1).map((photo, index) => <div key={photo} className="pointer-events-none absolute inset-0" style={{opacity:active === index + 1 && ready.includes(photo) ? 1 : 0}} aria-hidden="true">
      <CatalogCover src={photo} alt="" eager onReady={() => setReady(current => current.includes(photo) ? current : [...current, photo])} />
    </div>)}
    {children}
    {position !== null && photos.length > 1 ? <div className="pointer-events-none absolute inset-x-3 bottom-1 flex gap-1" aria-hidden="true">{photos.map((photo,index) => <span key={photo} className={`h-0.5 flex-1 rounded-full ${active === index ? "bg-white" : "bg-white/40"}`} />)}</div> : null}
  </div>;
}
