import assert from "node:assert/strict";
import test from "node:test";
import { PrestigeJapanExactSource, prestigeJapanImageProbeKind } from "../apps/web/lib/catalog/prestige-japan-exact-source";

test("AJES GIF89a content is rejected as a source NO FOTO placeholder", () => {
  assert.equal(prestigeJapanImageProbeKind("image/gif", new Uint8Array([0x47,0x49,0x46,0x38,0x39,0x61])), "placeholder");
});

test("AJES JPEG magic is accepted only with JPEG content type", () => {
  const jpeg = new Uint8Array([0xff,0xd8,0xff,0xe0,0x00,0x10]);
  assert.equal(prestigeJapanImageProbeKind("image/jpeg", jpeg), "vehicle");
  assert.equal(prestigeJapanImageProbeKind("application/octet-stream", jpeg), "unknown");
});

test("unknown image prefix fails closed instead of becoming a public cover", () => {
  assert.equal(prestigeJapanImageProbeKind("image/png", new Uint8Array([1,2,3,4,5,6])), "unknown");
});

test("Prestige verifies every gallery frame and removes a NO FOTO GIF before publication", async () => {
  const originalFetch = globalThis.fetch;
  const previousAttempts = process.env.PRESTIGE_JAPAN_IMAGE_PROBE_ATTEMPTS;
  const previousConcurrency = process.env.PRESTIGE_JAPAN_IMAGE_PROBE_CONCURRENCY;
  process.env.PRESTIGE_JAPAN_IMAGE_PROBE_ATTEMPTS = "1";
  process.env.PRESTIGE_JAPAN_IMAGE_PROBE_CONCURRENCY = "3";
  const urls = [
    "https://1.ajes.com/imgs/vehicle-cover",
    "https://1.ajes.com/imgs/vehicle-side",
    "https://1.ajes.com/imgs/no-foto",
    "https://1.ajes.com/imgs/vehicle-rear",
    "https://1.ajes.com/imgs/vehicle-interior",
    "https://1.ajes.com/imgs/vehicle-sheet",
  ];
  globalThis.fetch = (async (input) => {
    const placeholder = String(input).endsWith("/no-foto");
    return new Response(
      new Uint8Array(placeholder ? [0x47,0x49,0x46,0x38,0x39,0x61] : [0xff,0xd8,0xff,0xe0,0x00,0x10]),
      { status: 206, headers: { "content-type": placeholder ? "image/gif" : "image/jpeg" } },
    );
  }) as typeof fetch;

  try {
    const offer = { operational: { raw: { images: urls } } } as any;
    const images = await new PrestigeJapanExactSource().fetchImages(offer);
    const verified = urls.filter((url) => !url.endsWith("/no-foto"));
    assert.deepEqual(images.map((image) => image.url), verified);
    assert.deepEqual(offer.operational.raw.images, verified);
    assert.equal(offer.operational.galleryVerified, true);
    assert.equal(offer.operational.galleryImageCount, 5);
    assert.equal(offer.operational.gallerySourceImageCount, 6);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousAttempts === undefined) delete process.env.PRESTIGE_JAPAN_IMAGE_PROBE_ATTEMPTS;
    else process.env.PRESTIGE_JAPAN_IMAGE_PROBE_ATTEMPTS = previousAttempts;
    if (previousConcurrency === undefined) delete process.env.PRESTIGE_JAPAN_IMAGE_PROBE_CONCURRENCY;
    else process.env.PRESTIGE_JAPAN_IMAGE_PROBE_CONCURRENCY = previousConcurrency;
  }
});
