import assert from 'node:assert/strict';import fs from 'node:fs';import test from 'node:test';
const root=fs.readFileSync('apps/web/app/layout.tsx','utf8'),layout=fs.readFileSync('apps/web/app/(public)/layout.tsx','utf8'),counter=fs.readFileSync('apps/web/components/analytics/ConsentMetrika.tsx','utf8'),tracker=fs.readFileSync('apps/web/components/analytics/YandexMetrikaRouteTracker.tsx','utf8');
test('public analytics is consent-gated and excludes session replay and private request pages',()=>{
 assert.match(layout,/<ConsentMetrika \/>/);assert.doesNotMatch(layout,/mc\.yandex\.ru|<noscript/);assert.doesNotMatch(root,/112098062/);
 assert.match(counter,/analyticsAllowed\(\)&&!privatePage/);assert.match(counter,/webvisor:false/);assert.match(counter,/destruct/);assert.match(counter,/mc\.yandex\.ru\/metrika\/tag\.js\?id=112098062/);
});
test('route hits require consent and omit query parameters',()=>{assert.match(tracker,/if\(!analyticsAllowed\(\)/);assert.match(tracker,/window\.ym\?\.\(YANDEX_METRIKA_COUNTER_ID, "hit", currentUrl/);assert.doesNotMatch(tracker,/\$\{query\}/);});
