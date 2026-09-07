import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("apps/web/components/layout/RoutePreloader.tsx", "utf8");

test("route loader covers the complete public header with moving red-white candy stripes", () => {
  assert.match(source, /height:64px!important/);
  assert.match(source, /repeating-linear-gradient\(\d+deg,#[a-f0-9]+ 0 \d+px,#fff/);
  assert.match(source, /@keyframes ac-route-candy-sweep/);
  assert.match(source, /from\{transform:translate3d\(-60px,0,0\)\}[\s\S]*to\{transform:translate3d\(0,0,0\)\}/);
  assert.match(source, /prefers-reduced-motion:reduce/);
  assert.match(source, /ac-route-loader__label.*Загружаем страницу/s);
  assert.doesNotMatch(source, /ac-route-loader__pill/);
  assert.doesNotMatch(source, /BrandMark/);
});

test("loader does not artificially keep a completed route on screen", () => {
  assert.match(source, /const REVEAL_DELAY_MS = 100/);
  assert.match(source, /const MIN_VISIBLE_MS = 0/);
  assert.match(source, /router\.prefetch\(route\)/);
});
