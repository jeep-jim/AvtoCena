import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectKbPublicAccessPolicy,
  extractKbDeclaredSameOriginRoutes,
  visibleText,
} from '../scripts/catalog-source-kbchachacha-access-policy-probe-v1.mjs';

test('KB policy detector recognizes the official public scraping prohibition wording', () => {
  const html = `<!doctype html><html><body><footer>
    본 사이트/앱 상의 모든 정보, 콘텐츠, UI 등에 대한 무단 복제, 배포, 스크래핑 등의 행위는 법에 의하여 엄격히 금지됩니다.
  </footer></body></html>`;
  const result = detectKbPublicAccessPolicy(html);
  assert.equal(result.scrapingProhibited, true);
  assert.equal(result.explicitRestrictionObserved, true);
});

test('KB policy detector does not invent a restriction from ordinary marketplace text', () => {
  const result = detectKbPublicAccessPolicy('<main>중고차 검색 제조사 모델 연식 주행거리 가격 연료</main>');
  assert.equal(result.scrapingProhibited, false);
  assert.equal(result.automationRestricted, false);
  assert.equal(result.explicitRestrictionObserved, false);
});

test('KB declared route extraction records only same-origin .kbc anchors without following them', () => {
  const pageUrl = 'https://www.kbchachacha.com/public/search/main.kbc?_menu=buy';
  const html = `
    <a href="/public/search/list.kbc">list</a>
    <a href="https://www.kbchachacha.com/public/guide/serviceGuideDiagCar.kbc">guide</a>
    <a href="https://example.com/public/car/detail.kbc?id=123">external</a>
    <a href="/assets/app.js">script</a>
    <a href="/public/search/list.kbc">duplicate</a>
  `;
  assert.deepEqual(extractKbDeclaredSameOriginRoutes(html, pageUrl), [
    'https://www.kbchachacha.com/public/search/list.kbc',
    'https://www.kbchachacha.com/public/guide/serviceGuideDiagCar.kbc',
  ]);
});

test('visibleText strips scripts and styles so policy evidence must be user-visible', () => {
  const text = visibleText('<script>스크래핑 금지</script><style>.x{}</style><p>공개 검색</p>');
  assert.equal(text, '공개 검색');
});
