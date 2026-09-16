// Read-only post-deploy verification: no source crawls, forms or storage writes.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const origin = process.env.CATALOG_PUBLIC_ORIGIN || 'https://avtocena.com';
const report = {checkedAt:new Date().toISOString(),requests:[],quotes:[],ok:false};
async function read(path) {
  const started=performance.now();
  const response=await fetch(new URL(path,origin),{signal:AbortSignal.timeout(45000),redirect:'manual'});
  const headersAt=performance.now();
  const text=await response.text();
  report.requests.push({path,status:response.status,ttfbMs:Math.round(headersAt-started),totalMs:Math.round(performance.now()-started),bytes:Buffer.byteLength(text)});
  assert.equal(response.status,200,`HTTP ${response.status}: ${path}`);
  return text;
}
function decode(text) {return text.replace(/&quot;/g,'"').replace(/&#x27;|&#39;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');}
try {
  const home=JSON.parse(await read('/api/catalog/home'));
  report.marketCounts=home.marketCounts;
  for(const market of ['china','korea','uae','georgia','europe']) {
    const rows=home.items.filter(row=>row.market===market && (Number(row.totalRub)>0 || Number(row.sellerPriceRub)>0)).slice(0,2);
    assert.ok(rows.length,`No public quotes for ${market}`);
    for(const row of rows) {
      const html=await read(`/cars/offer/${encodeURIComponent(row.id)}`);
      const encoded=html.match(/data-offer-preview="([^"]+)"/)?.[1];
      assert.ok(encoded,`Offer page unavailable: ${row.id}`);
      const preview=JSON.parse(decode(encoded));
      const expected=Number(row.catalogPricingMode==='seller'?row.sellerPriceRub:row.publicVisibleRub || row.totalRub);
      const result={market,id:row.id,listRub:expected,detailRub:preview.totalRub,equal:expected===preview.totalRub,hasImage:Boolean(preview.imageUrl)};
      report.quotes.push(result);
      assert.equal(preview.totalRub,expected,`List/detail mismatch: ${row.id}`);
      assert.ok(preview.imageUrl,`Missing photo: ${row.id}`);
    }
  }
  const missing=await read('/cars/offer/unavailable-verification-example');
  assert.ok(missing.includes('unavailable-offer-title'));
  assert.ok(missing.includes('Перейти в каталог'));
  assert.ok(!missing.includes('data-offer-id='));
  await read('/api/catalog/home'); // repeat request timing, not a speed guarantee
  report.ok=true;
} catch(error) {report.error=String(error);process.exitCode=1;}
await fs.writeFile('catalog-public-quotes.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
