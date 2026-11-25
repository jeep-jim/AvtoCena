"use client";
import { cancelProtectedPhotoRetry, listenForVisiblePhotoRecovery, retryProtectedPhotoImage } from "./protected-photo-retry";
import { useEffect, useRef, useState } from "react";
import { catalogCoverThumbnail } from "@/lib/catalog/cover-image";
export type CatalogPhotoRecovery = {src: string; retry: () => void};
export function CatalogCover({src, alt, eager, onRecoveryChange}: {
  src:string; alt:string; eager:boolean;
  onRecoveryChange?: (recovery: CatalogPhotoRecovery | null) => void;
}) {
  const [failure, setFailure] = useState({src:"",stage:0});
  const stage = failure.src === src ? failure.stage : 0;
  const thumbnail = catalogCoverThumbnail(src);
  const imageRef = useRef<HTMLImageElement>(null);
  const placeholderRef = useRef<HTMLDivElement>(null);
  const automaticRecovery = useRef({src: "", used: false});
  const recoverable = Boolean(onRecoveryChange && src.startsWith("/api/catalog/photo/"));
  const handleFailure = (image: HTMLImageElement) => {
    if (image !== imageRef.current || image.getAttribute("src") !== (stage === 1 ? src : thumbnail)) return;
    if (!retryProtectedPhotoImage(image)) setFailure({src,stage:stage === 0 && thumbnail !== src && !src.startsWith('/api/catalog/photo/') ? 1 : 2});
  };
  useEffect(() => {
    const image = imageRef.current;
    // The server-rendered image may fail before React attaches onError.
    if (image?.complete && image.naturalWidth === 0) handleFailure(image);
    return () => { if (image) cancelProtectedPhotoRetry(image); };
  }, [src, stage]);
  useEffect(() => {
    if (automaticRecovery.current.src !== src) automaticRecovery.current = {src, used: false};
    if (!recoverable || stage < 2) { onRecoveryChange?.(null); return; }
    const placeholder = placeholderRef.current;
    if (!placeholder) return;
    let active = true;
    const retry = () => {
      // Lock before scheduling React state: repeated clicks/events cannot start
      // parallel cycles, and a stale action cannot revive an unmounted image.
      if (!active || !placeholder.isConnected) return;
      active = false;
      onRecoveryChange?.(null);
      setFailure({src, stage: 0});
    };
    onRecoveryChange?.({src, retry});
    const stop = automaticRecovery.current.used ? () => {} : listenForVisiblePhotoRecovery(placeholder, () => {
      if (!active) return;
      automaticRecovery.current = {src, used: true};
      retry();
    });
    return () => { active = false; stop(); onRecoveryChange?.(null); };
  }, [src, stage, recoverable, onRecoveryChange]);
  if (stage >= 2) return <div ref={placeholderRef} role="img" aria-label={`${alt}. Фото временно недоступно`} className="flex h-full w-full items-center justify-center bg-[var(--ac-surface-2)] px-4 text-center text-sm font-medium text-[var(--ac-muted)]">{recoverable ? null : "Фото временно недоступно"}</div>;
  return <img key={`${src}:${stage}`} ref={imageRef} src={stage === 1 ? src : thumbnail} alt={alt} width={400} height={300} className="h-full w-full object-cover object-[center_42%]" loading={eager ? "eager" : "lazy"} decoding="async" fetchPriority={eager ? "auto" : "low"} onLoad={event => cancelProtectedPhotoRetry(event.currentTarget)} onError={event => handleFailure(event.currentTarget)} />;
}
