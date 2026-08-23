import assert from "node:assert/strict";
import test from "node:test";
import {
  coherentGoonetImages,
  goonetListingId,
  goonetPrimaryImageUrl,
  isGoonetListingFrame,
} from "../apps/web/lib/catalog/goonet-exact-source";

const listingId = "989025071000203288001";
const page = `https://www.goo-net-exchange.com/usedcars/TOYOTA/PRIUS/${listingId}/`;
const primary = goonetPrimaryImageUrl(page);

function frame(index: number) {
  return primary.replace(/00\.jpg$/i, `${String(index).padStart(2, "0")}.jpg`);
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

test("Goo-net has no fallback cover when the exact primary frame is unavailable", () => {
  const rows = coherentGoonetImages([
    "https://picture1.goo-net.com/9890250710/00203288/J/D00701.jpg",
    "https://picture1.goo-net.com/9890250710/00203288/J/11111111111111111111101.jpg",
  ], 30, page);
  // The deterministic primary URL is still returned first, but fetchImages must
  // successfully download this exact frame or the whole offer is rejected.
  assert.equal(rows[0], primary);
});
