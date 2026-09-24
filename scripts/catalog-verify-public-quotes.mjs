// Read-only post-deploy verification: no source crawls, forms or storage writes.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {offerPath} from '../apps/web/lib/catalog/offer-url.ts';
import {getOffer} from '../apps/web/lib/catalog/storage.ts';
import {getSavedOfferCalculation} from '../apps/web/lib/catalog/saved-offer-calculation.ts';
import {getEffectiveMarketVersion} from '../apps/web/lib/effective-market-settings.ts';
const origin = process.env.CATALOG_PUBLIC_ORIGIN || 'https://avtocena.com';
const report = {checkedAt:new Date().toISOString(),requests:[],quotes:[],ok:false};
async function read(path, redirects = 0) {
  const started=performance.now();
  const response=await fetch(new URL(path,origin),{signal:AbortSignal.timeout(45000),redirect:'manual'});
  const headersAt=performance.now();
  const text=await response.text();
  report.requests.push({path,status:response.status,ttfbMs:Math.round(headersAt-started),totalMs:Math.round(performance.now()-started),bytes:Buffer.byteLength(text)});
  if ([301,302,303,307,308].includes(response.status)) {
    assert.ok(redirects < 3, `Redirect loop: ${path}`);
    const location=response.headers.get('location');
    assert.ok(location, `Missing redirect location: ${path}`);
    const target=new URL(location,new URL(path,origin));
    assert.equal(target.origin,new URL(origin).origin,'Public verification must stay on the site');
    return read(target.pathname+target.search,redirects+1);
  }
  assert.equal(response.status,200,`HTTP ${response.status}: ${path}`);
  return text;
}
function decode(text) {return text.replace(/&quot;/g,'"').replace(/&#x27;|&#39;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');}
try {
  const home=JSON.parse(await read('/api/catalog/home'));
  report.marketCounts=home.marketCounts;
  for(const market of ['china','korea','uae','georgia','europe','japan']) {
    const marketConfig=await getEffectiveMarketVersion(market);
    assert.ok(Number.isFinite(Number(marketConfig?.securityDepositRub)),`Missing configured advance: ${market}`);
    const rows=home.items.filter(row=>row.market===market && (Number(row.totalRub)>0 || Number(row.sellerPriceRub)>0)).slice(0,2);
    assert.ok(rows.length,`No public quotes for ${market}`);
    for(const row of rows) {
      const html=await read(offerPath(row));
      const encoded=html.match(/data-offer-preview="([^"]+)"/)?.[1];
      assert.ok(encoded,`Offer page unavailable: ${row.id}`);
      const preview=JSON.parse(decode(encoded));
      const listRub=Number(row.catalogPricingMode==='seller'?row.sellerPriceRub:row.publicVisibleRub || row.totalRub);
      const savedVersion=html.match(/data-offer-saved-version="([^"]+)"/)?.[1];
      let saved=null;
      if(savedVersion){
        const stored=await getOffer(row.id);
        assert.ok(stored,`Missing immutable offer for saved quote: ${row.id}`);
        saved=await getSavedOfferCalculation(stored);
        assert.ok(saved,`Unverified saved quote: ${row.id}`);
        assert.equal(saved.version,savedVersion,`Saved quote version mismatch: ${row.id}`);
      }
      const expected=saved?Number(saved.calculation.totalRub):listRub;
      const detailRub=Number(html.match(/data-offer-price-rub="([^"]+)"/)?.[1]);
      const result={market,id:row.id,listRub,expectedRub:expected,quoteBasis:saved?'verified_saved_calculation':'catalog',savedVersion:saved?.version,detailRub,equal:expected===detailRub,hasImage:Boolean(preview.imageUrl)};
      report.quotes.push(result);
      assert.equal(detailRub,expected,`List/detail mismatch: ${row.id}`);
      assert.ok(preview.imageUrl,`Missing photo: ${row.id}`);
      assert.ok(!html.includes('В том числе обеспечительный платёж'),`Obsolete payment hint: ${row.id}`);
      if(!saved && row.catalogPricingMode !== 'seller') {
        const bundle = html.match(/data-price-line="laboratory" data-price-amount-rub="([^"]+)"/);
        assert.ok(bundle && Number(bundle[1]) > 0,`Missing combined document cost: ${row.id}`);
        assert.ok(!/data-price-line="(?:sbkts|epts)"/.test(html),`Duplicate document lines: ${row.id}`);
        const deposits = [...html.matchAll(/data-payment-kind="security-deposit" data-payment-amount-rub="([^"]+)"/g)];
        assert.ok(!/data-price-line="security-deposit"/.test(html),`Advance counted as a cost: ${row.id}`);
        assert.equal(deposits.length,1,`Expected one advance: ${row.id}`);
        result.depositRub=Number(deposits[0][1]);
        result.expectedDepositRub=Number(marketConfig.securityDepositRub);
        result.marketConfigId=marketConfig.id;
        assert.equal(result.depositRub,result.expectedDepositRub,`Advance differs from active CRM settings: ${row.id}`);
        const lines = [...html.matchAll(/data-price-line="([^"]+)" data-price-amount-rub="([^"]+)"/g)];
        const car = lines.filter(line=>line[1]==='car');
        assert.equal(car.length,1,`Expected one vehicle remainder: ${row.id}`);
        result.vehicleRemainderRub=Number(car[0][2]);
        result.breakdownSumRub=lines.reduce((sum,line)=>sum+Number(line[2]),0);
        assert.equal(result.breakdownSumRub,detailRub,`Breakdown total mismatch: ${row.id}`);
        assert.ok(html.includes('Лаборатория, СБКТС, ЭПТС'));
        result.serviceBundleRub=Number(bundle[1]);
      }
    }
  }
  const missing=await read('/cars/offer/unavailable-verification-example');
  assert.ok(missing.includes('unavailable-offer-title'));
  assert.ok(missing.includes('Выбрать автомобиль'));
  assert.ok(!missing.includes('data-offer-id='));
  await read('/api/catalog/home'); // repeat request timing, not a speed guarantee
  report.ok=true;
} catch(error) {report.error=String(error);process.exitCode=1;}
await fs.writeFile('catalog-public-quotes.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
