import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeJsonObjectWithArrayAtomic } from "../scripts/lib/write-json-object-with-array.mjs";

test("identity master writer streams offers and atomically preserves the payload", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "avtocena-identity-stream-"));
  const filename = path.join(directory, "catalog-rebuild-europe-0.json");
  const rows = Array.from({ length: 600 }, (_, index) => ({
    id: `offer-${index}`,
    make: "Volkswagen",
    model: "Passat",
    images: Array.from({ length: 30 }, (__, imageIndex) => `https://example.test/${index}/${imageIndex}.jpg`),
    raw: { detail: "x".repeat(4096) },
  }));

  try {
    await fs.writeFile(filename, JSON.stringify({ version: 1, offers: [{ id: "stale" }] }));
    await writeJsonObjectWithArrayAtomic(filename, {
      version: 2,
      market: "europe",
      offers: [{ id: "must-not-survive" }],
      identityMaster: { applied: true },
    }, "offers", rows);

    const parsed = JSON.parse(await fs.readFile(filename, "utf8"));
    assert.equal(parsed.version, 2);
    assert.equal(parsed.market, "europe");
    assert.deepEqual(parsed.identityMaster, { applied: true });
    assert.equal(parsed.offers.length, rows.length);
    assert.equal(parsed.offers[0].id, "offer-0");
    assert.equal(parsed.offers.at(-1).id, `offer-${rows.length - 1}`);
    assert.equal(parsed.offers.some((offer: { id?: string }) => offer.id === "must-not-survive"), false);

    const leftovers = (await fs.readdir(directory)).filter((name) => name.includes(".stream.tmp"));
    assert.deepEqual(leftovers, []);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
