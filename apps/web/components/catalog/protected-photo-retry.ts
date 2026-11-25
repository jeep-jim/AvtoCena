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

/** One delayed recovery, or recovery on returning to a visible, online page.
 * The caller retains the per-source budget across image remounts. No polling. */
export function listenForVisiblePhotoRecovery(element: HTMLElement, recover: () => void) {
  const document = element.ownerDocument, window = document.defaultView;
  if (!window) return () => {};
  const availableAt = Date.now() + 15_000;
  let finished = false;
  const resume = () => {
    if (finished || Date.now() < availableAt || !element.isConnected
      || document.visibilityState !== "visible" || window.navigator.onLine === false) return;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= window.innerHeight
      || rect.right <= 0 || rect.left >= window.innerWidth) return;
    finished = true;
    clearTimeout(timer);
    recover();
  };
  const timer = setTimeout(resume, 15_000);
  window.addEventListener("online", resume);
  document.addEventListener("visibilitychange", resume);
  return () => {
    finished = true;
    clearTimeout(timer);
    window.removeEventListener("online", resume);
    document.removeEventListener("visibilitychange", resume);
  };
}
