import assert from "node:assert/strict";
import test from "node:test";
import { rankedCatalogImageUrls } from "../apps/web/lib/catalog/image-quality";
import { currentOfferShardName } from "../apps/web/lib/catalog/storage";

test("source-native JPAuc ids are uniformly bounded across current detail shards", () => {
  const shards = Array.from({ length: 512 }, (_, index) =>
    currentOfferShardName(`jpauc_japan_past_open:${344_600_000 + index}`));

  assert.ok(shards.every((shard) => /^[0-9a-f]{2}$/.test(shard)));
  assert.ok(new Set(shards).size >= 200, "JPAuc detail rows must not collapse into one giant shard");
});

test("JPAuc vehicle photos rank before the Aleado auction sheet", () => {
  const base = "https://p3.aleado.com/pic/?system=auto&date=2026-08-26&auct=37&bid=3429";
  const urls = rankedCatalogImageUrls({
    images: [0, 1, 2].map((number) => ({
      id: "",
      url: `${base}&number=${number}${number ? "&h=1280" : ""}`,
      objectKey: "",
      checksum: "",
      size: 0,
      mimeType: "image/jpeg",
    })),
  });

  assert.deepEqual(urls.map((url) => new URL(url).searchParams.get("number")), ["1", "2", "0"]);
});
