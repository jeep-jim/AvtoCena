import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';

const origin = 'https://avtocena.com';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({locale:'ru-RU'});
  const response = await page.request.get(origin+'/api/catalog/search?market=korea&marketPage=1&page=1&pageSize=24');
  assert.ok(response.ok(), 'Korean search response');
  const listing = await response.json();
  assert.ok(listing.ok && listing.items.length >= 3 && listing.total >= listing.items.length);
  await page.goto(origin+'/cars/korea', {waitUntil:'domcontentloaded'});
  await page.locator('article a[href*="/cars/offer/"]').first().waitFor();
  const evidence = [];
  for (const offer of listing.items) {
    assert.equal(offer.market, 'korea');
    assert.equal(offer.paidEncar, true, 'public row must come from the purchased snapshot');
    assert.equal(offer.sourceCurrency,'KRW');
    assert.ok(Number(offer.sourcePrice)>0,'positive source price');
    const link = page.locator('article a[href*="/cars/offer/'+offer.id+'/"]').first();
    if (!await link.count()) continue;
    const href = await link.getAttribute('href');
    const price = Number(offer.catalogPricingMode==='seller' ? offer.sellerPriceRub : offer.totalRub);
    if (!Number.isFinite(price) || price <= 0) continue;
    const card = link.locator('xpath=ancestor::article[1]');
    const digits = Math.round(price).toString();
    const showsPrice = body => body.replace(/[\s\u00a0\u202f]/g,'').includes(digits+'₽');
    assert.ok(showsPrice(await card.innerText()), 'visible listing price '+offer.id);
    const detail = await browser.newPage({locale:'ru-RU'});
    try {
      const opened = await detail.goto(new URL(href, origin).href,{waitUntil:'domcontentloaded'});
      assert.ok(opened?.ok());
      const main = detail.locator('main[data-offer-id="'+offer.id+'"]');
      await main.waitFor();
      const title = await main.locator('h1').innerText();
      assert.ok(title.trim());
      assert.equal(Math.round(Number(await main.getAttribute('data-offer-price-rub'))), Math.round(price));
      assert.ok(showsPrice(await main.innerText()), 'visible detail price '+offer.id);
      const photo = main.locator('img[alt$=", фото 1"]:visible').first();
      await photo.waitFor();
      const src = await photo.evaluate(async img => {
        await img.decode();
        if(img.naturalWidth<2 || img.naturalHeight<2)throw Error('photo did not decode');
        return img.currentSrc;
      });
      const url = new URL(src);
      const original = url.origin===origin ? new URL(url.searchParams.get('url')) : url;
      assert.equal(original.origin,'https://ci.encar.com');
      const file = original.pathname.split('/').pop();
      const id = file.match(/^(\d+)_/);
      assert.ok(id && createHash('sha256').update('encar_direct:'+id[1]).digest('hex').slice(0,24)===offer.id,'photo and offer identity');
      evidence.push({id:offer.id,title,rub:Math.round(price),sourceKrw:offer.sourcePrice,photo:file,url:detail.url()});
    } finally {await detail.close();}
    if(evidence.length===3)break;
  }
  assert.equal(new Set(evidence.map(o=>o.id)).size,3,'three distinct live listings');
  console.log(JSON.stringify({total:listing.total,generation:listing.generationId,offers:evidence},null,2));
} finally {await browser.close();}
