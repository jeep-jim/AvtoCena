import assert from "node:assert/strict";
import fs from "node:fs/promises";

const source = await fs.readFile(new URL("./catalog-simple-source-market.mjs", import.meta.url), "utf8");
assert.match(source, /APPROVED_SOURCE_IDS/);
assert.match(source, /withTimeout/);
assert.match(source, /await checkpoint\("page_complete"\)/);
assert.match(source, /gallery_timeout/);
assert.doesNotMatch(source, /source\.market === "multi"/);
console.log("catalog simple collector safety contract: ok");
