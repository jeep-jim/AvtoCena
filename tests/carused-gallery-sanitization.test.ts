import test from "node:test";
import assert from "node:assert/strict";
import { credibleCatalogImages } from "../apps/web/lib/catalog/offer-quality";

const carused = (group: string, frame: number, tiny = false) => ({
  id: "",
  objectKey: "",
  width: 1280,
  height: 853,
  size: 0,
  checksum: "",
  mimeType: "image/jpeg",
  url: `https://d1og64tg0ubvon.cloudfront.net/refno-cars/2026/0611/${group}/${String(frame).padStart(3, "0")}.jpg${tiny ? "?w=133&ts=1781662733" : "?ts=1781662733"}`,
});

test("Carused keeps one dominant exact stock family and strips 133px rendering", () => {
  const dirty = [
    carused("5585471", 1, true),
    carused("5585472", 1, true),
    carused("5585470", 1, true),
    carused("5585470", 1),
    carused("5585470", 2),
    carused("5585470", 3),
    carused("5585470", 4),
    { ...carused("5585470", 5), url: "https://carused.jp/_next/image?url=%2Fnext-images%2Fjumvea.png&w=256&q=75" },
  ];

  const clean = credibleCatalogImages(dirty as any);
  assert.equal(clean.length, 4);
  assert.equal(clean.every((image) => image.url.includes("/5585470/")), true);
  assert.equal(clean.some((image) => /[?&]w=133(?:&|$)/.test(image.url)), false);
  assert.deepEqual(clean.map((image) => new URL(image.url).pathname.split("/").pop()), ["001.jpg", "002.jpg", "003.jpg", "004.jpg"]);
});

test("Carused rejects an ambiguous tie instead of publishing neighbour stock", () => {
  const ambiguous = [carused("5585471", 1, true), carused("5585470", 1, true)];
  assert.deepEqual(credibleCatalogImages(ambiguous as any), []);
});
