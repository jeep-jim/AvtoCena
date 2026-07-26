import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../apps/web/lib/catalog/priority-fast-gallery-wrapper.ts", import.meta.url), "utf8");

test("listing images are cached before the optional detail gallery", () => {
  const cacheAt = source.indexOf("cacheImageFromUrl(url");
  const fastReturnAt = source.indexOf("listingImages.length >= minimum");
  const detailAt = source.indexOf("source.fetchImages(offer)");
  assert.ok(cacheAt >= 0);
  assert.ok(fastReturnAt > cacheAt);
  assert.ok(detailAt > fastReturnAt);
  assert.match(source, /Math\.min\(30/);
  assert.match(source, /image\.size > 8_000/);
});
