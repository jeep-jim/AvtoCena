import assert from "node:assert/strict";
import test from "node:test";
import { rankedCatalogImageUrls } from "../apps/web/lib/catalog/image-quality";

test("catalog rewrites stale stored CDN URL to current same-origin image route", () => {
  const urls = rankedCatalogImageUrls({
    images: [{
      id: "abc123",
      url: "https://img.avtocena.com/stale/catalog-image.jpg",
      objectKey: "catalog/images/korea/checksum.jpg",
      mimeType: "image/jpeg",
      size: 120_000,
      width: 1_200,
      height: 800,
    }],
  });
  assert.deepEqual(urls, ["/api/catalog/images/abc123"]);
});
