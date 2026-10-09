"use client";
import { cancelProtectedPhotoRetry, retryProtectedPhotoImage } from "./protected-photo-retry";
import { useEffect, useRef, useState } from "react";
import { catalogCoverThumbnail } from "@/lib/catalog/cover-image";
export function CatalogCover({src, alt, eager}: {src:string; alt:string; eager:boolean}) {
  const [failure, setFailure] = useState({src:"",stage:0});
  const stage = failure.src === src ? failure.stage : 0;
  const thumbnail = catalogCoverThumbnail(src);
  const imageRef = useRef<HTMLImageElement>(null);
  const handleFailure = (image: HTMLImageElement) => {
    if (!retryProtectedPhotoImage(image)) setFailure({src,stage:stage === 0 && thumbnail !== src ? 1 : 2});
  };
  useEffect(() => {
    const image = imageRef.current;
    // The server-rendered image may fail before React attaches onError.
    if (image?.complete && image.naturalWidth === 0) handleFailure(image);
    return () => { if (image) cancelProtectedPhotoRetry(image); };
  }, [src, stage]);
  if (stage >= 2) return <div role="img" aria-label={`${alt}. Фото временно недоступно`} className="flex h-full w-full items-center justify-center bg-[var(--ac-surface-2)] px-4 text-center text-sm font-medium text-[var(--ac-muted)]">Фото временно недоступно</div>;
  return <img ref={imageRef} src={stage === 1 ? src : thumbnail} alt={alt} width={400} height={300} className="h-full w-full object-cover object-[center_42%]" loading={eager ? "eager" : "lazy"} decoding="async" fetchPriority={eager ? "auto" : "low"} onLoad={event => cancelProtectedPhotoRetry(event.currentTarget)} onError={event => handleFailure(event.currentTarget)} />;
}
