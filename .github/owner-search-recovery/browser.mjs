// One owner-triggered anonymous public verification, no submissions or writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const marker=JSON.parse(fs.readFileSync('.github/market-runs/owner-search-recovery-verify.json','utf8'));
const origin='https://avtocena.com';
const report={expectedRelease:marker.release,checkedAt:new Date().toISOString(),environment:'GitHub Actions Chromium; external network; anonymous visitor',checks:[],passed:false};
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});
try{
  for(const width of [390,1280]){
    const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
    const page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(String(e.message).slice(0,300)));
    const health=await context.request.get(origin+'/api/health',{timeout:20000});
    assert.equal(health.status(),200);assert.equal((await health.json()).releaseSha,marker.release);
    const start=performance.now();
    const response=await page.goto(origin+'/cars/china/BMW/3?powerTo=160&sort=totalRub',{waitUntil:'domcontentloaded',timeout:90000});
    assert.equal(response.status(),200);
    const cards=page.locator('article.ac-catalog-card, article.ac-catalog-list-row');
    await cards.first().waitFor({timeout:60000});
    const catalogReadySeconds=(performance.now()-start)/1000;
    const heading=await page.locator('h1').first().textContent();assert.ok(!heading.includes('%20'));
    const offerHref=await cards.first().locator('a[href^="/cars/offer/"]').first().getAttribute('href');assert.ok(offerHref);
    let recommendationRequests=0;
    page.on('request',r=>{if(new URL(r.url()).pathname==='/api/catalog/recommendations')recommendationRequests++;});
    const detailStart=performance.now();
    const detailResponse=await page.goto(new URL(offerHref,origin).href,{waitUntil:'domcontentloaded',timeout:90000});
    assert.equal(detailResponse.status(),200);
    const rail=page.locator('[data-deferred-recommendations="related"]');await rail.waitFor({state:'attached',timeout:60000});
    const detailReadySeconds=(performance.now()-detailStart)/1000;
    await page.waitForTimeout(350);assert.equal(recommendationRequests,0,'primary offer must not start related-market searches');
    const cookie=page.getByRole('complementary',{name:'Уведомление о cookie'});
    if(await cookie.isVisible())await cookie.getByRole('button',{name:'Закрыть',exact:true}).click();
    const relatedStart=performance.now();
    const pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/catalog/recommendations',{timeout:25000});
    await rail.scrollIntoViewIfNeeded();const relatedResponse=await pending;
    assert.equal(relatedResponse.status(),200);
    assert.match(relatedResponse.headers()['cache-control']||'',/private.*no-store/);
    const data=await relatedResponse.json();assert.equal(data.kind,'related');
    const relatedCards=rail.locator('article.ac-catalog-card, article.ac-catalog-list-row');await relatedCards.first().waitFor({timeout:15000});
    const relatedReadySeconds=(performance.now()-relatedStart)/1000;
    await page.evaluate(()=>scrollTo(0,0));await rail.scrollIntoViewIfNeeded();await page.waitForTimeout(350);
    assert.equal(recommendationRequests,1,'viewport re-entry must reuse loaded recommendations');
    assert.equal(data.current.id,new URL(relatedResponse.url()).searchParams.get('id'));
    const result={width,catalogReadySeconds:Number(catalogReadySeconds.toFixed(3)),detailReadySeconds:Number(detailReadySeconds.toFixed(3)),relatedReadySeconds:Number(relatedReadySeconds.toFixed(3)),heading,relatedCards:await relatedCards.count(),partial:!!data.partial,recommendationRequests,pageErrors:errors,passed:errors.length===0};
    report.checks.push(result);assert.equal(result.passed,true);
    await context.close();
  }
  report.passed=report.checks.length===2&&report.checks.every(row=>row.passed);
}catch(error){report.error=String(error.message).slice(0,1500);throw error;}
finally{fs.writeFileSync('owner-search-recovery-browser.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));await browser.close();}
