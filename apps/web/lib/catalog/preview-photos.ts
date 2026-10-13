import { offerImages } from "./offer-images";

export const DESKTOP_PHOTO_PREVIEW = "(min-width: 1024px) and (hover: hover) and (pointer: fine)";
export function previewPhotos(cover: string, photos: readonly string[]) {
  return offerImages([cover, ...photos], 5);
}
export function previewPhotoIndex(position: number, count: number) {
  return Math.max(0, Math.min(count - 1, Math.floor(position * count)));
}
