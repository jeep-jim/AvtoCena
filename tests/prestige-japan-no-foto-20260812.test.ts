import assert from "node:assert/strict";
import test from "node:test";
import { prestigeJapanImageProbeKind } from "../apps/web/lib/catalog/prestige-japan-exact-source";

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
