import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const myauto = fs.readFileSync(new URL("../apps/web/lib/catalog/myauto-list-source.ts", import.meta.url), "utf8");
const scale = fs.readFileSync(new URL("../apps/web/lib/catalog/scale-market-sources.ts", import.meta.url), "utf8");

test("MyAuto uses the exact Yandex-compatible canonical request and rejects rental ads", () => {
  assert.match(myauto, /accept: "text\/html,application\/xhtml\+xml,application\/json;q=0\.9,\*\/\*;q=0\.8"/);
  assert.match(myauto, /"accept-language": "en-US,en;q=0\.9,ka;q=0\.8"/);
  assert.match(myauto, /Mozilla\/5\.0 \(X11; Linux x86_64\).*Chrome\/150 Safari\/537\.36/);
  assert.doesNotMatch(myauto, /"cache-control": "no-cache"/);
  assert.doesNotMatch(myauto, /pragma: "no-cache"/);
  assert.doesNotMatch(myauto, /referer: "https:\/\/www\.myauto\.ge\/"/);
  assert.doesNotMatch(myauto, /sec-fetch-dest/);
  assert.match(myauto, /for-rent/);
});

test("AutoPapa uses the current USD search path and current detail link shape", () => {
  assert.match(scale, /https:\/\/autopapa\.ge\/en\/usd\/search/);
  assert.match(scale, /numeric-id/);
  assert.doesNotMatch(scale, /pageQuery\("https:\/\/autopapa\.ge\/en\/cars"/);
});
