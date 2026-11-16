import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const categories = ['claims', 'zero', 'missing'];
const count = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const cleanError = error => String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500);

export function paidKoreaProviderDataRequest(value, resourceType) {
  if (!['document', 'xhr', 'fetch', 'websocket', 'eventsource', 'ping'].includes(resourceType)) return false;
  const hostname = new URL(value).hostname;
  return ['87.242.72.57', '78.46.90.228'].includes(hostname)
    || ['auto-api.com', 'tru.ru', 'encar.com'].some(domain => hostname === domain || hostname.endsWith('.' + domain));
}
let contractPromise;
async function contract() {
  return contractPromise ||= build({
    entryPoints: [fileURLToPath(new URL('../../apps/web/components/catalog/paid-korea-report-contract.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false,
  }).then(result => import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')));
}

/** Receipt selection is independent of the page/API under test. */
export function validatePaidKoreaLiveReceipt(receipt) {
  assert.equal(receipt?.completed, true, 'paid_report_preparation_incomplete');
  assert.equal(receipt.provider, 'auto_api_encar', 'paid_report_receipt_provider');
  assert.ok(typeof receipt.observedAt === 'string' && Number.isFinite(Date.parse(receipt.observedAt)), 'paid_report_receipt_observation');
  const coverage = receipt.coverage;
  assert.ok(count(coverage?.currentCount) && coverage.currentCount > 0, 'paid_report_current_count');
  assert.equal(coverage.covered, coverage.currentCount, 'paid_report_incomplete_coverage');
  assert.ok(count(coverage.historyPresent) && count(coverage.historyMissing), 'paid_report_history_coverage_counts');
  assert.equal(coverage.historyPresent + coverage.historyMissing, coverage.currentCount, 'paid_report_history_coverage_sum');
  const selected = [], unavailableCategories = [];
  for (const category of categories) {
    const sample = coverage.samples?.[category];
    if (sample === null) {unavailableCategories.push(category); continue;}
    assert.ok(sample && typeof sample === 'object', 'paid_report_sample_missing:' + category);
    assert.match(sample.offerId || '', /^[a-f0-9]{24}$/, 'paid_report_sample_offer_id');
    assert.match(sample.sourceOfferId || '', /^\d{6,10}$/, 'paid_report_sample_lot');
    assert.equal(sample.offerId, createHash('sha256').update('encar_direct:' + sample.sourceOfferId).digest('hex').slice(0, 24), 'paid_report_sample_identity');
    const history = sample.history;
    if (category === 'missing') assert.equal(history, null, 'paid_report_missing_sample_has_history');
    else {
      assert.ok(history && typeof history === 'object' && !Array.isArray(history), 'paid_report_sample_history');
      if (category === 'zero') assert.ok(history.own_damage_count === 0 && history.other_damage_count === 0, 'paid_report_zero_sample_not_zero');
      if (category === 'claims') assert.ok(count(history.own_damage_count) && history.own_damage_count > 0 || count(history.other_damage_count) && history.other_damage_count > 0, 'paid_report_claims_sample_not_positive');
    }
    selected.push({category, sample});
  }
  assert.ok(selected.length > 0, 'paid_report_no_actual_samples');
  assert.equal(new Set(selected.map(({sample}) => sample.offerId)).size, selected.length, 'paid_report_duplicate_sample');
  return {selected, unavailableCategories};
}

/** Compare the actual API response with the independently saved coverage sample. */
export async function assertPaidKoreaLivePayload(value, sample, kind, observedAt) {
  const {normalizePaidKoreaReport, validPaidKoreaReport} = await contract();
  assert.ok(validPaidKoreaReport(value, sample.offerId, sample.sourceOfferId, kind), 'paid_report_public_contract');
  assert.equal(value.observedAt, observedAt, 'paid_report_public_observation');
  const expected = normalizePaidKoreaReport(sample, {offerId: sample.offerId, lot: sample.sourceOfferId, kind, observedAt});
  if (kind === 'history') {
    if (sample.history === null) assert.equal(value.history, null, 'paid_report_null_history_changed');
    else {
      assert.ok(value.history, 'paid_report_public_history_missing');
      for (const key of ['report_date', 'own_damage_count', 'own_damage_cost_won', 'other_damage_count', 'other_damage_cost_won']) {
        assert.deepEqual(value.history[key], expected.history?.[key] ?? null, 'paid_report_saved_history_mismatch:' + key);
      }
      const expectedCount = sample.history.accidentCount;
      if (expectedCount === null || expectedCount > 100) assert.equal(value.history.accidents, null, 'paid_report_unavailable_claims_changed');
      else {
        assert.ok(count(expectedCount), 'paid_report_invalid_expected_claim_count');
        assert.equal(value.history.accidents?.length, expectedCount, 'paid_report_claim_count_mismatch');
      }
    }
  } else if (sample.inspection === null) assert.equal(value.inspection, null, 'paid_report_null_inspection_changed');
  else {
    assert.ok(sample.inspection && typeof sample.inspection === 'object' && !Array.isArray(sample.inspection), 'paid_report_saved_inspection_shape');
    for (const key of ['issue_date', 'accident', 'simple_repair', 'flood', 'special_history', 'recall', 'recall_completed', 'tuning', 'tuning_types', 'usage_changes', 'panels', 'panel_codes', 'systems']) {
      if (Object.hasOwn(sample.inspection, key)) assert.deepEqual(value.inspection?.[key] ?? null, expected.inspection?.[key] ?? null, 'paid_report_saved_inspection_mismatch:' + key);
    }
  }
  return value;
}

export async function runPaidKoreaReportLive(env = process.env) {
  const report = {
    schemaVersion: 1, release: env.EXPECTED_RELEASE || null, nonce: env.VERIFICATION_NONCE || null,
    calculationVersion: env.EXPECTED_CALCULATION_VERSION || null, passed: false,
    receiptSha256: null, checks: [], unavailableCategories: [], network: {violations: []},
    health: {before: null, after: null}, startedAt: new Date().toISOString(), finishedAt: null,
  };
  const output = path.resolve(env.PAID_KOREA_REPORT_OUTPUT || 'paid-korea-report-live-report.json');
  let browser, healthContext, activeContext, origin, failure, deadlineExceeded = false;
  const workDeadline = Date.now() + 95000;
  const deadlineTimer = setTimeout(() => {
    deadlineExceeded = true;
    if (activeContext) void activeContext.close().catch(() => undefined);
    else void browser?.close().catch(() => undefined);
  }, 95000);
  async function health(phase) {
    const response = await healthContext.request.get(`${origin}/api/health?verification_nonce=${encodeURIComponent(report.nonce)}&phase=${phase}`, {timeout: 20000, headers: {'Cache-Control': 'no-cache'}});
    const value = await response.json();
    const observed = {status: response.status(), ok: value.ok, releaseSha: value.releaseSha, calculationVersion: value.calculationVersion};
    report.health[phase] = observed;
    assert.equal(observed.status, 200, 'paid_report_health_status:' + phase);
    assert.equal(observed.ok, true, 'paid_report_health_ok:' + phase);
    assert.equal(observed.releaseSha, report.release, 'paid_report_release_mismatch:' + phase);
    assert.equal(observed.calculationVersion, report.calculationVersion, 'paid_report_calculation_mismatch:' + phase);
    return observed;
  }
  try {
    assert.match(report.release || '', /^[a-f0-9]{40}$/, 'paid_report_expected_release_required');
    assert.match(report.calculationVersion || '', /^[a-f0-9]{64}$/, 'paid_report_expected_calculation_required');
    assert.match(report.nonce || '', /^[A-Za-z0-9._:-]{8,160}$/, 'paid_report_nonce_required');
    const url = new URL(env.PUBLIC_ORIGIN || 'https://avtocena.com');
    assert.ok(url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'paid_report_public_origin');
    origin = url.origin;
    assert.ok(path.isAbsolute(env.PAID_KOREA_REPORT_RECEIPT || ''), 'paid_report_receipt_absolute_path_required');
    const receiptBytes = await fs.readFile(env.PAID_KOREA_REPORT_RECEIPT);
    assert.ok(receiptBytes.length <= 4 * 1024 * 1024, 'paid_report_receipt_too_large');
    report.receiptSha256 = createHash('sha256').update(receiptBytes).digest('hex');
    const receipt = JSON.parse(receiptBytes.toString('utf8'));
    const selection = validatePaidKoreaLiveReceipt(receipt);
    report.unavailableCategories = selection.unavailableCategories;
    const {chromium} = await import(env.PLAYWRIGHT_MODULE || 'playwright');
    browser = await chromium.launch({headless: true, executablePath: env.CHROME_BIN, args: ['--no-sandbox'], timeout: 30000});
    healthContext = await browser.newContext();
    await health('before');
    const screenshotDirectory = path.resolve(env.PAID_KOREA_REPORT_SCREENSHOTS || 'artifacts/paid-korea-report-live');
    await fs.mkdir(screenshotDirectory, {recursive: true});
    for (const {category, sample} of selection.selected) for (const width of [390, 1440]) {
      assert.ok(!deadlineExceeded && Date.now() < workDeadline, 'paid_report_live_deadline');
      const check = {category, width, offerId: sample.offerId, lot: sample.sourceOfferId, passed: false, requests: {history: 0, inspection: 0}, pageErrors: []};
      report.checks.push(check);
      const context = await browser.newContext({viewport: {width, height: 1000}, isMobile: width < 768, hasTouch: width < 768, reducedMotion: 'reduce'});
      activeContext = context;
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      let releaseHistory;
      const historyHeld = new Promise(resolve => releaseHistory = resolve);
      const matchesReport = (request, kind) => {
        const requestUrl = new URL(request.url());
        return requestUrl.origin === origin && requestUrl.pathname === '/api/catalog/korea-report' && requestUrl.searchParams.get('kind') === kind && requestUrl.searchParams.get('id') === sample.offerId && requestUrl.searchParams.get('lot') === sample.sourceOfferId;
      };
      page.on('pageerror', error => check.pageErrors.push(cleanError(error)));
      await page.route('**/*', async route => {
        const request = route.request(), requestUrl = new URL(request.url());
        let reportDocument = false;
        if (requestUrl.origin !== origin && request.resourceType() === 'document') {
          try {
            if (request.frame() === page.mainFrame()) reportDocument = await page.evaluate(() => Boolean(document.activeElement?.closest('[data-paid-korea-report-panel]')));
            else {
              const frameElement = await request.frame().frameElement();
              reportDocument = await frameElement.evaluate(element => Boolean(element.closest('[data-paid-korea-report-panel]')));
              await frameElement.dispose();
            }
          } catch { /* A detached baseline frame is not evidence of a report request. */ }
        }
        // Preserve existing analytics and galleries. Only supplier data requests
        // and external documents initiated inside this report are new failures.
        if (requestUrl.origin !== origin && (paidKoreaProviderDataRequest(requestUrl.href, request.resourceType()) || reportDocument)) {
          report.network.violations.push({origin: requestUrl.origin, path: requestUrl.pathname.slice(0, 180), resourceType: request.resourceType()});
          await route.abort('blockedbyclient');
        } else await route.continue();
      });
      await page.route('**/api/catalog/korea-report?*', async route => {
        const request = route.request(), kind = new URL(request.url()).searchParams.get('kind');
        if (!['history', 'inspection'].includes(kind) || !matchesReport(request, kind)) {
          report.network.violations.push({path: '/api/catalog/korea-report', reason: 'unexpected_report_identity'});
          await route.abort('blockedbyclient'); return;
        }
        check.requests[kind]++;
        if (kind === 'history' && check.requests.history === 1) await historyHeld;
        await route.continue();
      });
      try {
        const response = await page.goto(`${origin}/cars/offer/${sample.offerId}`, {waitUntil: 'domcontentloaded', timeout: 30000});
        assert.ok(response?.ok(), 'paid_report_offer_page_status');
        assert.equal(new URL(page.url()).origin, origin, 'paid_report_offer_external_redirect');
        await page.locator(`[data-offer-id="${sample.offerId}"]`).waitFor({state: 'attached'});
        await page.locator('.ac-route-loader').waitFor({state: 'attached'});
        const cookie = page.getByRole('complementary', {name: 'Уведомление о cookie'});
        if (await cookie.isVisible()) await cookie.getByRole('button', {name: 'Закрыть', exact: true}).click();
        const trigger = page.locator('[data-korea-report-trigger]:visible');
        await trigger.waitFor(); await page.waitForTimeout(150);
        assert.deepEqual(check.requests, {history: 0, inspection: 0}, 'paid_report_initial_request');
        await trigger.click();
        const panel = page.locator('[data-paid-korea-report-panel]:visible');
        await panel.waitFor();
        assert.deepEqual(check.requests, {history: 0, inspection: 0}, 'paid_report_outer_request');
        const historySection = panel.locator('[data-korea-report-section="history"]');
        const historyResponse = page.waitForResponse(value => matchesReport(value.request(), 'history'));
        await historySection.getByRole('button', {name: 'Страховая история', exact: true}).click();
        await historySection.getByText('Загружаем отчёт…', {exact: true}).waitFor();
        await trigger.click(); await trigger.click();
        assert.equal(check.requests.history, 1, 'paid_report_pending_replay_requested_again');
        check.pendingReplayVerified = true;
        releaseHistory();
        const receivedHistory = await historyResponse;
        assert.equal(receivedHistory.status(), 200, 'paid_report_history_api_status');
        const historyBody = await assertPaidKoreaLivePayload(await receivedHistory.json(), sample, 'history', receipt.observedAt);
        if (historyBody.history === null) {
          await historySection.getByText('Сведения о страховой истории не предоставлены.', {exact: true}).waitFor();
          assert.equal(await historySection.locator('[data-paid-korea-count]').count(), 0, 'paid_report_missing_rendered_zero');
        } else {
          for (const [side, countKey, costKey] of [['own', 'own_damage_count', 'own_damage_cost_won'], ['other', 'other_damage_count', 'other_damage_cost_won']]) {
            const value = historyBody.history[countKey], countElement = historySection.locator(`[data-paid-korea-count="${side}"]`);
            await countElement.waitFor();
            assert.equal((await countElement.innerText()).replace(/\s/g, ''), value === null ? 'Нетданных' : String(value), 'paid_report_visible_count:' + side);
            const card = countElement.locator('xpath=ancestor::section[1]');
            const cost = historyBody.history[costKey];
            assert.equal((await card.locator('dd').last().innerText()).replace(/\s/g, ''), cost === null ? 'Нетданных' : String(cost) + 'KRW', 'paid_report_visible_krw:' + side);
          }
          assert.equal(await historySection.locator('[data-paid-korea-claim]').count(), historyBody.history.accidents?.length || 0, 'paid_report_visible_claim_count');
          const firstClaim = historyBody.history.accidents?.[0];
          if (firstClaim) {
            const claim = historySection.locator('[data-paid-korea-claim]').first();
            for (const key of ['damage_to', 'paid_by']) if (firstClaim[key] !== null) await claim.getByText(firstClaim[key], {exact: true}).first().waitFor();
            if (firstClaim.date) assert.ok((await claim.locator('h4').innerText()).includes(firstClaim.date.split('-').reverse().join('.')), 'paid_report_visible_claim_date');
            for (const [key, label] of [['insurance_benefit_won', 'Страховая выплата'], ['parts_won', 'Запчасти'], ['labor_won', 'Работы'], ['painting_won', 'Окраска']]) {
              const visible = await claim.locator('dt').filter({hasText: new RegExp('^' + label + '$')}).locator('..').locator('dd').innerText();
              assert.equal(visible.replace(/\s/g, ''), firstClaim[key] === null ? 'Нетданных' : String(firstClaim[key]) + 'KRW', 'paid_report_visible_claim_money:' + key);
            }
          }
        }
        check.history = historyBody.history === null ? null : Object.fromEntries(['own_damage_count', 'own_damage_cost_won', 'other_damage_count', 'other_damage_cost_won'].map(key => [key, historyBody.history[key]]));
        const inspectionSection = panel.locator('[data-korea-report-section="inspection"]');
        const inspectionResponse = page.waitForResponse(value => matchesReport(value.request(), 'inspection'));
        await inspectionSection.getByRole('button', {name: 'Осмотр автомобиля', exact: true}).click();
        const receivedInspection = await inspectionResponse;
        assert.equal(receivedInspection.status(), 200, 'paid_report_inspection_api_status');
        const inspectionBody = await assertPaidKoreaLivePayload(await receivedInspection.json(), sample, 'inspection', receipt.observedAt);
        if (inspectionBody.inspection || inspectionBody.diagnosis) await inspectionSection.locator('[data-paid-korea-inspection]').waitFor();
        else await inspectionSection.getByText('Сведения об осмотре и диагностике не предоставлены.', {exact: true}).waitFor();
        check.inspectionPresent = inspectionBody.inspection !== null;
        check.diagnosisPresent = inspectionBody.diagnosis !== null;
        for (const [title, map] of [['Кузов и силовые элементы', inspectionBody.inspection?.panels], ['Системы автомобиля', inspectionBody.inspection?.systems]]) {
          const first = Object.entries(map || {}).find(([, values]) => Object.keys(values).length);
          if (!first) continue;
          const [group, values] = first;
          const mapSection = inspectionSection.getByRole('heading', {name: title, level: 4, exact: true}).locator('..');
          const summary = mapSection.locator('summary').filter({hasText: new RegExp('^' + group.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$')});
          await summary.click();
          const [label, value] = Object.entries(values)[0];
          const groupDetails = summary.locator('..');
          await groupDetails.getByText(label, {exact: true}).first().waitFor();
          await groupDetails.getByText(value, {exact: true}).first().waitFor();
        }
        await trigger.click(); await trigger.click();
        assert.deepEqual(check.requests, {history: 1, inspection: 1}, 'paid_report_loaded_replay_requested_again');
        check.loadedReplayVerified = true;
        assert.equal(await panel.locator('iframe,a,img').count(), 0, 'paid_report_external_embed');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'paid_report_horizontal_overflow');
        assert.ok(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'paid_report_panel_overflow');
        assert.deepEqual(check.pageErrors, [], 'paid_report_browser_errors');
        assert.deepEqual(report.network.violations, [], 'paid_report_external_network');
        await historySection.scrollIntoViewIfNeeded();
        await page.screenshot({path: path.join(screenshotDirectory, `${category}-${width}.png`)});
        check.passed = true;
      } catch (error) {
        check.error = cleanError(error);
        await page.screenshot({path: path.join(screenshotDirectory, `${category}-${width}-failure.png`)}).catch(() => undefined);
        throw error;
      } finally {releaseHistory(); await context.close(); activeContext = undefined;}
    }
  } catch (error) {failure = error; report.error = deadlineExceeded ? 'paid_report_live_deadline' : cleanError(error);}
  finally {
    clearTimeout(deadlineTimer);
    if (deadlineExceeded) {failure ||= new Error('paid_report_live_deadline'); report.error ||= 'paid_report_live_deadline';}
    if (healthContext) {
      try {await health('after');}
      catch (error) {failure ||= error; report.error ||= cleanError(error); if (!report.health.after) report.health.after = {error: cleanError(error)};}
    }
    await browser?.close().catch(() => undefined);
    report.passed = !failure && report.checks.length > 0 && report.checks.every(check => check.passed) && report.network.violations.length === 0;
    report.finishedAt = new Date().toISOString();
    await fs.mkdir(path.dirname(output), {recursive: true});
    await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPaidKoreaReportLive().then(report => {
    console.log('PAID_KOREA_REPORT_LIVE', JSON.stringify(report));
    if (!report.passed) process.exitCode = 1;
  }).catch(error => {console.error(cleanError(error)); process.exitCode = 1;});
}
