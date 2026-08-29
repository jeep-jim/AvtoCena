import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { prestigeJapanGithubEgressRequest } from "../apps/web/lib/catalog/prestige-japan-exact-source";

function withGithubActions<T>(worker: () => T) {
  const previous = process.env.GITHUB_ACTIONS;
  process.env.GITHUB_ACTIONS = "true";
  try { return worker(); }
  finally {
    if (previous === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = previous;
  }
}

test("GitHub Prestige traffic uses only the fixed production egress operations", () => withGithubActions(() => {
  const landing = prestigeJapanGithubEgressRequest("https://prestigemotorsport.com.au/auctions/");
  assert.equal(landing.url, "https://avtocena.com/api/internal/prestige-egress-c1e8b2?kind=landing");

  const ajax = prestigeJapanGithubEgressRequest("https://prestigemotorsport.com.au/wp-admin/admin-ajax.php", { method: "POST", body: "action=search_model_car&marka_id=1&auction-date=Past" });
  assert.equal(ajax.url, "https://avtocena.com/api/internal/prestige-egress-c1e8b2?kind=ajax");
  assert.equal(ajax.init?.body, "action=search_model_car&marka_id=1&auction-date=Past");

  const detail = prestigeJapanGithubEgressRequest("https://prestigemotorsport.com.au/auction-vehicle-display/?car_id=exact_123");
  assert.equal(detail.url, "https://avtocena.com/api/internal/prestige-egress-c1e8b2?kind=detail&carId=exact_123");
}));

test("local and production Prestige traffic stays direct", () => {
  const previous = process.env.GITHUB_ACTIONS;
  delete process.env.GITHUB_ACTIONS;
  try {
    const url = "https://prestigemotorsport.com.au/auctions/";
    assert.equal(prestigeJapanGithubEgressRequest(url).url, url);
  } finally {
    if (previous !== undefined) process.env.GITHUB_ACTIONS = previous;
  }
});

test("Prestige egress route is fixed-domain and exposes no arbitrary upstream URL", () => {
  const source = fs.readFileSync("apps/web/app/api/internal/prestige-egress-c1e8b2/route.ts", "utf8");
  assert.match(source, /const BASE = "https:\/\/prestigemotorsport\.com\.au"/);
  assert.match(source, /search_model_car/);
  assert.match(source, /search_results_car_dev/);
  assert.doesNotMatch(source, /searchParams\.get\(["']url["']\)/);
});
