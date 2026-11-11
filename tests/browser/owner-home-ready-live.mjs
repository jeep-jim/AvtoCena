import assert from 'node:assert/strict';
import fs from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const marker = JSON.parse(fs.readFileSync('.github/market-runs/owner-home-browser.json', 'utf8'));
const origin = 'https://avtocena.com';
const report = { release: marker.release, phase: marker.phase, checkedAt: new Date().toISOString(), environment: 'GitHub Actions Chromium; external network; DOM cards and two animation frames, not photo completion or server p95', checks: [], passed: false };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN, args: ['--no-sandbox'] });
try {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block', locale: 'ru-RU' });
    await context.addCookies([{ name: 'avtocena_city', value: encodeURIComponent('Москва'), url: origin }]);
    const health = async () => { const r = await context.request.get(origin + '/api/health', { timeout: 30000 }); assert.equal(r.status(), 200); assert.equal((await r.json()).releaseSha, marker.release); };
    await health();
    const page = await context.newPage(), errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (new URL(r.url()).origin === origin && ['document', 'fetch', 'xhr'].includes(r.resourceType())) requests.push(new URL(r.url()).pathname); });
    const result = { width, navigations: [] }; report.checks.push(result);
    const dealer = page.locator('.ac-special-rails--split a.ac-special-card');
    const cards = page.locator('article.ac-catalog-card,article.ac-catalog-list-row');
    const rows = async () => dealer.evaluateAll(nodes => nodes.map(n => ({ href: n.getAttribute('href'), title: n.querySelector('h3')?.textContent, price: n.querySelector('.ac-price')?.textContent })).sort((a, b) => a.href.localeCompare(b.href)));
    for (const phase of ['first', 'repeat']) {
      requests.length = 0;
      const started = performance.now();
      const response = await page.goto(origin + '/?city=' + encodeURIComponent('Москва'), { waitUntil: 'commit', timeout: 90000 });
      assert.equal(response.status(), 200);
      const [catalogSeconds, dealerSeconds] = await Promise.all([cards.first().waitFor({ timeout: 60000 }).then(() => (performance.now() - started) / 1000), marker.expectedDealerCards > 0 ? dealer.first().waitFor({ timeout: 60000 }).then(() => (performance.now() - started) / 1000) : Promise.resolve(null)]);
      await page.waitForFunction(() => { const b = document.querySelector('button[aria-label="Выбрать город. Сейчас: Москва"]'); return b && !b.disabled; }, null, { timeout: 60000 });
      await page.waitForLoadState('domcontentloaded', { timeout: 60000 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const dealerRows = await rows();
      assert.equal(dealerRows.length, marker.expectedDealerCards, 'dealer block must preserve the observed baseline');
      assert.ok(dealerRows.every(r => r.href && r.title && r.price));
      result.navigations.push({ phase, catalogSeconds: +catalogSeconds.toFixed(3), dealerSeconds: dealerSeconds === null ? null : +dealerSeconds.toFixed(3), readySeconds: +((performance.now() - started) / 1000).toFixed(3), cards: await cards.count(), dealerRows, requests: requests.length, requestPaths: [...requests] });
    }
    const consent = page.getByRole('button', { name: 'Хорошо', exact: true }); if (await consent.isVisible()) await consent.click();
    await page.getByRole('button', { name: 'Выбрать город. Сейчас: Москва', exact: true }).first().click();
    const picker = page.getByRole('dialog', { name: 'Выбор города' });
    await picker.getByRole('textbox', { name: 'Поиск города' }).fill('Новокуз');
    await picker.getByRole('button', { name: /Новокузнецк/ }).first().click();
    await page.waitForURL(url => url.searchParams.get('city') === 'Новокузнецк', { waitUntil: 'commit' });
    await page.getByRole('button', { name: 'Выбрать город. Сейчас: Новокузнецк', exact: true }).first().waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const response = await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); assert.equal(response.status(), 200);
    if (marker.expectedDealerCards > 0) await dealer.first().waitFor({ timeout: 60000 });
    await page.waitForFunction(() => { const b = document.querySelector('button[aria-label="Выбрать город. Сейчас: Новокузнецк"]'); return b && !b.disabled; });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const afterNavigation = await rows();
    assert.ok(afterNavigation.length > 0, 'Novokuznetsk dealer offers must render after navigation');
    const repeat = await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }); assert.equal(repeat.status(), 200);
    await dealer.first().waitFor({ timeout: 60000 });
    await page.waitForFunction(() => { const b = document.querySelector('button[aria-label="Выбрать город. Сейчас: Новокузнецк"]'); return b && !b.disabled; });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(await rows(), afterNavigation, 'dealer prices and identities must survive repeat navigation in the same city');
    result.novokuznetskDealerCards = afterNavigation.length;
    assert.equal(decodeURIComponent((await context.cookies()).find(c => c.name === 'avtocena_city')?.value || ''), 'Новокузнецк');
    result.cityPreserved = true; result.city = 'Новокузнецк'; result.pageErrors = errors; assert.deepEqual(errors, []);
    await health(); await context.close();
  }
  report.passed = true;
} catch (error) { report.error = String(error.message).slice(0, 1000); throw error; }
finally { fs.writeFileSync('owner-home-browser-report.json', JSON.stringify(report, null, 2) + '\n'); console.log('OWNER_HOME_BROWSER', JSON.stringify(report)); await browser.close(); }
