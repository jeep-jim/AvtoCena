// Bounded transport qualification, NOT a catalog publication or completeness claim.
import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { captureCheMobileDom } from './lib/che168-mobile-dom-capture.mjs';
import { parseChe168MobileRecord } from './lib/che168-mobile-record.mjs';

const out = process.env.CHE168_CANARY_OUTPUT || '/tmp/che168-mobile-canary';
await mkdir(out, {recursive:true});
const report = {startedAt:new Date().toISOString(),sourceId:'autohome_used_china_open',
  purpose:'qualify ordinary mobile DOM transport; no publication',collected:0,published:0,
  ready:0,needs_data:0,sourceCoverageComplete:false,stopReasons:[],records:[]};
let browser, page;
const saveDom = async name => {
  if (page && !page.isClosed()) await writeFile(`${out}/${name}.html.gz`,gzipSync(await page.content()));
};
const checkPage = async () => {
  const u=new URL(page.url());
  const text=await page.locator('body').innerText();
  if (!['m.che168.com','www.che168.com'].includes(u.hostname)) throw Error('non_domestic_redirect');
  if (/captcha|verify you are human|security verification|checking your browser|访问验证|安全验证|人机验证/i.test(text)) throw Error('access_challenge');
  if (/login-required|\/login\b/.test(u.pathname)) throw Error('login_required');
};
try {
  const {chromium}=await import(pathToFileURL(process.env.CHE168_PLAYWRIGHT_MODULE).href);
  // Default browser identity and network. No stealth plugins, proxy, imported cookies or credentials.
  // Ubuntu's installed Chrome has its normal AppArmor sandbox profile; the downloaded
  // headless-shell build cannot start its sandbox on the hosted Ubuntu 24 runner.
  browser=await chromium.launch({channel:'chrome',headless:true,chromiumSandbox:true});
  const context=await browser.newContext();
  page=await context.newPage();
  page.setDefaultTimeout(25000);
  await page.goto('https://m.che168.com/china/list/',{waitUntil:'domcontentloaded',timeout:45000});
  await checkPage();
  const localChoice=page.getByText('Continue to Chinese Site',{exact:true});
  if(await localChoice.isVisible())await localChoice.click();
  await page.getByText(/(?:19|20)\d{2}款/).first().waitFor();
  await checkPage();
  await saveDom('list-first');
  const titles=await page.evaluate(()=>[...new Set(Array.from(document.querySelectorAll('div')).filter(e=>e.children.length===0&&/(?:19|20)\d{2}款/.test(e.textContent)).map(e=>e.textContent.trim()))]);
  report.listingTitles=titles;
  // Three listings qualify transport only. Production intake limits are unchanged.
  for(const title of titles.slice(0,3)) {
    const candidate=page.getByText(title,{exact:true});
    if(await candidate.count()!==1){report.stopReasons.push('listing_changed');continue;}
    await candidate.click();
    await page.waitForURL(/\/cardetail\/index\?/, {timeout:25000});
    await checkPage();
    const id=new URL(page.url()).searchParams.get('infoid');
    if(!/^\d+$/.test(id||''))throw Error('detail_identity_missing');
    await page.getByText(/^\d+(?:\.\d+)?[LT]$/).first().click();
    await page.getByText('车型名称',{exact:true}).waitFor();
    await checkPage();
    // The parameter panel lazy-renders its lower rows; do not stop at the engine section.
    const parameterPane=page.locator('div.r-150rngu').filter({hasText:/^牌照信息标配/});
    await parameterPane.hover();
    let tableScrollComplete=false;
    for(let step=0;step<8;step++) {
      await page.mouse.wheel(0,18000);
      await page.waitForTimeout(400);
      await checkPage();
      const end=await parameterPane.evaluate(e=>e.scrollTop+e.clientHeight>=e.scrollHeight-4);
      if(end){tableScrollComplete=true;break;}
    }
    if(!tableScrollComplete)throw Error('parameter_table_scroll_incomplete');
    const capture={...await page.evaluate(captureCheMobileDom),capturedAt:new Date().toISOString(),tableScrollComplete};
    const parsed=parseChe168MobileRecord(capture,id);
    await writeFile(`${out}/${id}.json`,JSON.stringify(capture,null,2));
    await saveDom(id);
    report.records.push({...parsed,raw:undefined,tableRows:undefined,imageUrls:undefined,imageCount:parsed.imageUrls.length});
    report.collected++;report.needs_data++;
    await page.goBack({waitUntil:'domcontentloaded'});
    await checkPage();
    await page.getByText(/(?:19|20)\d{2}款/).first().waitFor();
  }
  if(!report.collected)throw Error('no_bound_mobile_records');
  report.stopReasons.push('bounded_transport_probe_completed');
} catch(error) {
  report.stopReasons.push(String(error?.message||error));
  try {await saveDom('stopped');}catch{}
  process.exitCode=1;
} finally {
  report.finishedAt=new Date().toISOString();
  await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
  if(browser)await browser.close();
  console.log(JSON.stringify(report));
}
