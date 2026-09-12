import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { formatCatalogCount } from "../apps/web/lib/catalog/count-format";

test("catalog counts group every thousand, including four digits and zero", () => {
  for (const [n, expected] of [[0,"0"],[1,"1"],[999,"999"],[1000,"1\u00a0000"],[1847,"1\u00a0847"],[12908,"12\u00a0908"],[37718,"37\u00a0718"],[1000000,"1\u00a0000\u00a0000"],[9007199254740991,"9\u00a0007\u00a0199\u00a0254\u00a0740\u00a0991"]] as const) {
    assert.equal(formatCatalogCount(n), expected);
    assert.equal(Number(formatCatalogCount(n).replace(/\s/g,"")), n);
  }
});
test("invalid counts are not silently shown as zero", () => {
  for (const n of [NaN,Infinity,-1,1.5,Number.MAX_SAFE_INTEGER+1]) assert.equal(formatCatalogCount(n),"—");
});
test("counter renders once outside the mobile-hidden heading wrapper before filters", () => {
  const source = readFileSync("apps/web/app/(public)/cars/page.tsx","utf8");
  assert.equal((source.match(/data-catalog-result-count=/g)||[]).length,1);
  assert.match(source,/<\/div>\s*<p className="ac-catalog-result-count/);
  const counter = source.slice(source.indexOf('<p className="ac-catalog-result-count'),source.indexOf('<CatalogFilters initial='));
  assert.ok(!/\bhidden\b|lg:block|display:\s*none/.test(counter.replace('aria-hidden="true"','')));
  assert.match(counter,/ac-pulse-dot ac-pulse-dot--status/);
  assert.match(counter,/role="status"/);
  assert.match(counter,/formatCatalogCount\(total\)/);
  assert.ok(!source.includes('Найдено: {total}'));
});
test("both home and catalog use the same count formatter without changing source totals", () => {
  const page=readFileSync("apps/web/app/(public)/cars/page.tsx","utf8");
  const home=readFileSync("apps/web/components/home/HomePageClient.tsx","utf8");
  assert.match(page,/formatCatalogCount\(market.total\)/);
  assert.match(page,/groupedMarkets.reduce\(\(sum, market\) => sum \+ market.total, 0\)/);
  assert.match(home,/formatCatalogCount\(count\)/);
  assert.match(home,/formatCatalogCount\(electricOnly \? group.total : marketCounts\[group.id\] \|\| group.total\)/);
});
