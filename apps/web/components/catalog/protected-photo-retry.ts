import type { SyntheticEvent } from "react";
const pending = new WeakMap<HTMLImageElement, ReturnType<typeof setTimeout>>();
const attempts = new WeakMap<HTMLImageElement, {src: string; count: number}>();

export function cancelProtectedPhotoRetry(image: HTMLImageElement) {
  const timer = pending.get(image);
  if (timer !== undefined) clearTimeout(timer);
  pending.delete(image);
}

/** Bounded, spaced retries of the same signed URL; never bypass source limits. */
export function retryProtectedPhotoImage(image: HTMLImageElement) {
  const src = image.getAttribute("src") || "";
  if (!src.startsWith("/api/catalog/photo/")) return false;
  if (pending.has(image)) return true;
  const previous = attempts.get(image);
  const count = previous?.src === src ? previous.count : 0;
  if (count >= 2) return false;
  image.dataset.photoRetried = src;
  const timer = setTimeout(() => {
    pending.delete(image);
    if (!image.isConnected || image.getAttribute("src") !== src || (image.complete && image.naturalWidth > 0)) return;
    attempts.set(image, {src, count: count + 1});
    image.src = src;
  }, (count === 0 ? 15_000 : 35_000) + Math.random() * 3000);
  pending.set(image, timer);
  return true;
}

export function retryProtectedPhoto(event: SyntheticEvent<HTMLImageElement>) {
  return retryProtectedPhotoImage(event.currentTarget);
}
