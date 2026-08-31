import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const rootLayout = fs.readFileSync("apps/web/app/layout.tsx", "utf8");
const publicLayout = fs.readFileSync("apps/web/app/(public)/layout.tsx", "utf8");
const tracker = fs.readFileSync("apps/web/components/analytics/YandexMetrikaRouteTracker.tsx", "utf8");

test("Yandex Metrika counter 112098062 is installed on every public page with the owner settings", () => {
  assert.match(publicLayout, /mc\.yandex\.ru\/metrika\/tag\.js\?id=112098062/);
  assert.match(publicLayout, /ym\(112098062, 'init'/);
  assert.match(publicLayout, /ssr:true/);
  assert.match(publicLayout, /webvisor:true/);
  assert.match(publicLayout, /clickmap:true/);
  assert.match(publicLayout, /ecommerce:"dataLayer"/);
  assert.match(publicLayout, /accurateTrackBounce:true/);
  assert.match(publicLayout, /trackLinks:true/);
  assert.match(publicLayout, /mc\.yandex\.ru\/watch\/112098062/);
  assert.doesNotMatch(rootLayout, /112098062/);
});

test("Yandex Metrika records client-side Next.js route changes without duplicating the first hit", () => {
  assert.match(tracker, /usePathname/);
  assert.match(tracker, /useSearchParams/);
  assert.match(tracker, /if \(!initialized\.current\)/);
  assert.match(tracker, /window\.ym\?\.\(YANDEX_METRIKA_COUNTER_ID, "hit", currentUrl/);
  assert.match(publicLayout, /<YandexMetrikaRouteTracker \/>/);
});
