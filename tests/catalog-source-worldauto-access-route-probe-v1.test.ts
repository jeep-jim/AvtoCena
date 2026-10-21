import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectWorldAutoPublicAccessPolicy,
  extractWorldAutoDeclaredRoutes,
} from '../scripts/catalog-source-worldauto-access-route-probe-v1.mjs';

test('detects an explicit English automation restriction only when prohibition language is nearby', () => {
  const blocked = detectWorldAutoPublicAccessPolicy(`
    <html><body><footer>Unauthorized automated access, crawling and scraping are prohibited.</footer></body></html>
  `);
  assert.equal(blocked.explicitRestrictionObserved, true);
  assert.ok(blocked.matchedWindowCount > 0);

  const neutral = detectWorldAutoPublicAccessPolicy(`
    <html><body><p>Our crawler-friendly sitemap helps search engines discover public pages.</p></body></html>
  `);
  assert.equal(neutral.explicitRestrictionObserved, false);
});

test('detects an explicit Russian scraping restriction', () => {
  const policy = detectWorldAutoPublicAccessPolicy(`
    <html><body>Автоматизированный парсинг и использование ботов без разрешения запрещено.</body></html>
  `);
  assert.equal(policy.explicitRestrictionObserved, true);
});

test('extracts only source-declared same-origin routes and does not guess APIs', () => {
  const html = `
    <html><head>
      <script src="/_next/static/chunks/app.js"></script>
      <script src="https://cdn.example.com/external.js"></script>
    </head><body>
      <a href="/en/search/car">Search</a>
      <a href="/en/search/car/tbilisi">City filter</a>
      <a href="/en/car/toyota-prius-12345">Vehicle</a>
      <a href="/en/terms">Terms</a>
      <a href="https://example.com/car/other">External</a>
    </body></html>
  `;
  const routes = extractWorldAutoDeclaredRoutes(
    html,
    'https://worldauto.ge/en/search/car',
    'https://worldauto.ge/en/search/car',
  );
  assert.deepEqual(routes.policyLinks, ['https://worldauto.ge/en/terms']);
  assert.deepEqual(routes.detailLikeRouteCandidates, ['https://worldauto.ge/en/car/toyota-prius-12345']);
  assert.deepEqual(routes.sameOriginScriptUrls, ['https://worldauto.ge/_next/static/chunks/app.js']);
  assert.equal(routes.sameOriginAnchors.includes('https://example.com/car/other'), false);
});
