import assert from "node:assert/strict";
import test from "node:test";
import { selectAutoPapaGeorgiaGallery } from "../apps/web/lib/catalog/autopapa-georgia-source";

test("AutoPapa keeps the list cover first and only exact-listing originals from detail", () => {
  const cover = "https://autopapa.ge/system/car/photos/009/066/595/medium.jpg?1770802543";
  const detail = `
    <img src="/system/car/photos/009/066/595/labels_facebook1.jpg">
    <img src="/system/car/photos/009/066/595/labels1.jpg">
    <img src="/system/car/photos/009/066/595/small.jpg?1770802543">
    <img src="/system/car/photos/009/066/596/original.jpg?1770802545">
    <img src="/system/car/photos/009/066/596/small.jpg?1770802545">
    <img src="/system/car/photos/009/066/597/original.jpg?1770802546">
    <img src="/system/car/photos/009/411/399/thumb.jpg?1786202604">
    <img src="/system/car/photos/009/411/400/original.jpg?1786202605">
  `;

  assert.deepEqual(selectAutoPapaGeorgiaGallery(detail, "https://autopapa.ge/en/usd/chevrolet/captiva/932906", [cover]), [
    cover,
    "https://autopapa.ge/system/car/photos/009/066/596/original.jpg?1770802545",
    "https://autopapa.ge/system/car/photos/009/066/597/original.jpg?1770802546",
  ]);
});

test("AutoPapa refuses detail gallery expansion when no listing-bound cover identifies the owner prefix", () => {
  const detail = `<img src="/system/car/photos/009/066/596/original.jpg?1770802545">`;
  assert.deepEqual(selectAutoPapaGeorgiaGallery(detail, "https://autopapa.ge/en/usd/chevrolet/captiva/932906", []), []);
});
