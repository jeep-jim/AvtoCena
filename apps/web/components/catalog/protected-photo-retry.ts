import type { SyntheticEvent } from "react";
/** One delayed retry only, same signed URL; never bypass the proxy on failure. */
export function retryProtectedPhoto(event: SyntheticEvent<HTMLImageElement>) {
  const image = event.currentTarget;
  const src = image.getAttribute("src") || "";
  if (!src.startsWith("/api/catalog/photo/") || image.dataset.photoRetried === src) return false;
  image.dataset.photoRetried = src;
  setTimeout(() => { if (image.isConnected && image.getAttribute("src") === src) image.src = src; }, 15_000 + Math.random() * 3000);
  return true;
}
