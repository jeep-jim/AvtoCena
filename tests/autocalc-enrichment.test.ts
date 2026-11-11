import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extractKnownSource} from '../apps/web/lib/autocalc/load';
import {sourceIdentity} from '../apps/web/lib/autocalc/sources';
test('DubiCars real listing: exact power, gallery and price; rounded litres stay unresolved',async()=>{
 const data=await extractKnownSource(readFileSync('tests/fixtures/autocalc/dubicars-977430.html','utf8'),'https://www.dubicars.com/2020-hyundai-kona-hyundai-kona-gcc-specs-2020-mid-option-gls-20l-in-excellent-condition-977430.html');
 assert.equal(data.draft.powerHp,'150');assert.equal(data.draft.fuel,'petrol');assert.equal(data.price,'7900');assert.equal(data.currency,'USD');assert.equal(data.images.length,15);assert.equal(data.draft.engineCc,undefined);assert.match(data.notes?.join(' ')||'',/2 L/);
});
test('AutoScout detail uses own vehicle and public price, not registration as manufacture date',async()=>{
 const d=JSON.parse(readFileSync('tests/fixtures/autocalc/autoscout.json','utf8'));const html=`<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:{listingDetails:d}}})}</script>`;
 const data=await extractKnownSource(html,`https://www.autoscout24.com/offers/opel-${d.id}`);assert.equal(data.price,'3445');assert.equal(data.currency,'EUR');assert.equal(data.draft.engineCc,'1598');assert.equal(data.draft.powerKw,'82');assert.equal(data.draft.year,undefined);assert.ok(data.images.length>1);
 const other=await extractKnownSource(html,'https://www.autoscout24.com/offers/opel-00000000-0000-0000-0000-000000000000');assert.equal(other.price,'');assert.equal(other.images.length,0);
});
test('source identity never accepts lookalike hosts or arbitrary KCar IDs',()=>{
 assert.equal(sourceIdentity('https://kcar.com.evil.example/?i_sCarCd=EC61405827'),null);
 assert.equal(sourceIdentity('https://www.kcar.com/bc/detail/carInfoDtl?i_sCarCd=../../metadata'),null);
 assert.equal(sourceIdentity('https://www.kcar.com/bc/detail/carInfoDtl?i_sCarCd=EC61405827')?.id,'EC61405827');
});
test('AutoPapa retains source currency and separates rounded engine size from exact hp',async()=>{
 const d=await extractKnownSource(readFileSync('tests/fixtures/autocalc/autopapa-961979.html','utf8'),'https://autopapa.ge/en/subaru/xv-crosstrek-premium/961979');
 assert.equal(d.market,'georgia');assert.equal(d.price,'24776');assert.equal(d.currency,'GEL');assert.equal(d.images.length,6);assert.equal(d.draft.powerHp,'152');assert.equal(d.draft.fuel,'petrol');assert.equal(d.draft.engineCc,undefined);
});
