import assert from "node:assert/strict";
import test from "node:test";
import { credibleCatalogImages } from "../apps/web/lib/catalog/offer-quality";
import {
  coherentGoonetImages,
  goonetListingId,
  goonetPrimaryImageUrl,
  isGoonetListingFrame,
  isGoonetPageBoundJFrame,
} from "../apps/web/lib/catalog/goonet-exact-source";

const listingId = "989025071000203288001";
const page = `https://www.goo-net-exchange.com/usedcars/TOYOTA/PRIUS/${listingId}/`;
const primary = goonetPrimaryImageUrl(page);

function frame(index: number) {
  return primary.replace(/00\.jpg$/i, `${String(index).padStart(2, "0")}.jpg`);
}

function image(url: string) {
  return {
    id: "",
    objectKey: "",
    width: 1280,
    height: 853,
    size: 0,
    checksum: "",
    mimeType: "image/jpeg",
    url,
  };
}

const liveListingId = "402026080500704382002";
const livePage = `https://www.goo-net-exchange.com/usedcars/HONDA/FIT/${liveListingId}/`;
const livePrimary = goonetPrimaryImageUrl(livePage);
function liveFrame(index: number, family = "0704382A20260804G002") {
  return `https://picture1.goo-net.com/070/0704382/J/${family}${String(index).padStart(2, "0")}.jpg`;
}

test("Goo-net gallery only accepts exact listing-id frames and keeps 00 as cover", () => {
  const banner = "https://picture1.goo-net.com/9890250710/00203288/J/D00701.jpg";
  const unrelated = "https://picture1.goo-net.com/9890250710/00203288/J/98902507100020328899901.jpg";
  const rows = coherentGoonetImages([
    banner,
    frame(3),
    unrelated,
    frame(1),
    primary,
    frame(2),
  ], 30, page);
  assert.equal(goonetListingId(page), listingId);
  assert.equal(rows[0], primary);
  assert.deepEqual(rows, [primary, frame(1), frame(2), frame(3)]);
  assert.equal(rows.includes(banner), false);
  assert.equal(rows.includes(unrelated), false);
});

test("Goo-net source-bound frame check rejects dealer assets and another offer", () => {
  assert.equal(isGoonetListingFrame(primary, listingId), true);
  assert.equal(isGoonetListingFrame(frame(12), listingId), true);
  assert.equal(isGoonetListingFrame("https://picture1.goo-net.com/x/J/D00701.jpg", listingId), false);
  assert.equal(isGoonetListingFrame(primary.replace(listingId, "111111111111111111111"), listingId), false);
});

test("Goo-net exact page accepts its coherent long J family behind the verified 00 cover", () => {
  const catalog = "https://catalogphoto.goo-net.com/carphoto/10101044_201506j.jpg";
  const shortDealer = "https://picture1.goo-net.com/070/0704382/J/D00701.jpg";
  const competingSingle = liveFrame(1, "0704382A20260804G999");
  const rows = coherentGoonetImages([
    catalog,
    shortDealer,
    liveFrame(3),
    competingSingle,
    liveFrame(1),
    liveFrame(2),
  ], 30, livePage);
  assert.equal(rows[0], livePrimary);
  assert.deepEqual(rows, [livePrimary, liveFrame(1), liveFrame(2), liveFrame(3)]);
  assert.equal(isGoonetPageBoundJFrame(liveFrame(1)), true);
  assert.equal(isGoonetPageBoundJFrame(shortDealer), false);
});

test("Goo-net has no fallback cover when the exact primary frame is unavailable", () => {
  const rows = coherentGoonetImages([
    "https://picture1.goo-net.com/9890250710/00203288/J/D00701.jpg",
    "https://picture1.goo-net.com/9890250710/00203288/J/11111111111111111111101.jpg",
  ], 30, page);
  // The deterministic primary URL is still returned first, but fetchImages must
  // successfully download this exact frame or the whole offer is rejected.
  assert.equal(rows[0], primary);
});

test("central catalog sanitizer removes retained Goo-net dealer/catalog assets and keeps exact frames", () => {
  const dirty = [
    image("https://catalogphoto.goo-net.com/carphoto/35101510_201808z.jpg"),
    image("https://picture1.goo-net.com/070/0704382/J/0704382A20260804G00201.jpg"),
    image(frame(3)),
    image(primary),
    image(frame(1)),
  ];
  const clean = credibleCatalogImages(dirty as any);
  assert.deepEqual(clean.map((row) => row.url), [primary, frame(1), frame(3)]);
});

test("central Goo-net sanitizer recovers one dominant retained exact-page J family", () => {
  const dirty = [
    image("https://catalogphoto.goo-net.com/carphoto/10101044_201506j.jpg"),
    image("https://picture1.goo-net.com/070/0704382/J/D00701.jpg"),
    image(liveFrame(3)),
    image(liveFrame(1, "0704382A20260804G999")),
    image(liveFrame(1)),
    image(liveFrame(2)),
  ];
  const clean = credibleCatalogImages(dirty as any);
  assert.deepEqual(clean.map((row) => row.url), [liveFrame(1), liveFrame(2), liveFrame(3)]);
});

test("central Goo-net sanitizer rejects legacy-only or ambiguous exact listing galleries", () => {
  const legacyOnly = [
    image("https://catalogphoto.goo-net.com/carphoto/35101510_201808z.jpg"),
    image("https://picture1.goo-net.com/070/0704382/J/0704382A20260804G00201.jpg"),
  ];
  assert.deepEqual(credibleCatalogImages(legacyOnly as any), []);

  const otherListingId = "111111111111111111111";
  const otherPrimary = `https://picture1.goo-net.com/${otherListingId.slice(0, 10)}/${otherListingId.slice(10, 18)}/J/${otherListingId}00.jpg`;
  assert.deepEqual(credibleCatalogImages([image(primary), image(otherPrimary)] as any), []);

  const tiedPageFamilies = [
    image(liveFrame(1)),
    image(liveFrame(2)),
    image(liveFrame(1, "0704382A20260804G999")),
    image(liveFrame(2, "0704382A20260804G999")),
  ];
  assert.deepEqual(credibleCatalogImages(tiedPageFamilies as any), []);
});
