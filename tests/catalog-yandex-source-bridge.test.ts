import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const bridge = fs.readFileSync(new URL("../apps/web/lib/catalog/yandex-source-bridge.ts", import.meta.url), "utf8");
const importer = fs.readFileSync(new URL("../apps/web/lib/catalog/importer.ts", import.meta.url), "utf8");
const guaziRoute = fs.readFileSync(new URL("../apps/web/app/api/internal/guazi-egress-b8c4d1/route.ts", import.meta.url), "utf8");
const georgiaRoute = fs.readFileSync(new URL("../apps/web/app/api/internal/georgia-recovery-e2f913/route.ts", import.meta.url), "utf8");

test("GitHub collectors use bounded Yandex egress for source sites that block GitHub IPs", () => {
  assert.match(bridge, /process\.env\.GITHUB_ACTIONS/);
  assert.match(bridge, /CATALOG_DISABLE_YANDEX_SOURCE_BRIDGE/);
  assert.match(bridge, /https:\/\/avtocena\.com/);
  assert.match(bridge, /\/api\/internal\/guazi-egress-b8c4d1\?page=\$\{page\}/);
  assert.match(bridge, /\/api\/internal\/georgia-recovery-e2f913\?source=\$\{kind\}&pages=1&startPage=\$\{page\}/);
  assert.doesNotMatch(bridge, /searchParams\.get\(["']url["']\)/);
  assert.match(importer, /withGithubYandexSourceBridge\(myAutoListSource, "myauto"\)/);
  assert.match(importer, /withGithubYandexSourceBridge\(autoPapaGeorgiaSource, "autopapa"\)/);
  assert.match(importer, /withGithubYandexSourceBridge\(guaziChinaExactSource, "guazi"\)/);
});

test("Guazi Yandex endpoint is fixed-source only and preserves exact listing gallery verification", () => {
  assert.match(guaziRoute, /guaziChinaExactSource\.fetchPage\(String\(page\)\)/);
  assert.match(guaziRoute, /guaziChinaExactSource\.normalizeOffer\(raw\)/);
  assert.match(guaziRoute, /guaziChinaExactSource\.fetchImages\(offer\)/);
  assert.match(guaziRoute, /Math\.min\(10_000, page\)/);
  assert.doesNotMatch(guaziRoute, /searchParams\.get\(["']url["']\)/);
  assert.doesNotMatch(guaziRoute, /YC_OBJECT_STORAGE|JSON_STORAGE_DRIVER|SECRET_ACCESS_KEY/);
});

test("Georgia bridge reuses the existing bounded Yandex canonical recovery endpoint", () => {
  assert.match(georgiaRoute, /sourceValue === "myauto" \|\| sourceValue === "autopapa"/);
  assert.match(georgiaRoute, /collectGeorgiaYandexRecoverySnapshot\(pages, startPage, source\)/);
  assert.doesNotMatch(georgiaRoute, /searchParams\.get\(["']url["']\)/);
});
