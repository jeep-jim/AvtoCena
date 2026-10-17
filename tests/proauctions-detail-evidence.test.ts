import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {parseProAuctionsDetailEvidence as parse} from '../apps/web/lib/catalog/proauctions-detail-evidence';
const dir=new URL('./fixtures/proauctions/',import.meta.url);
const fixture=(id:string)=>fs.readFileSync(new URL(id+'.html',dir),'utf8');
const url=(html:string)=>html.match(/rel="canonical" href="([^"]+)"/)![1];
const base=fixture('30162134');
test('ten archived primary details parse with matching auction amount and separate powers',()=>{
 for(const file of fs.readdirSync(dir).filter(f=>/^\d+\.html$/.test(f))){const h=fs.readFileSync(new URL(file,dir),'utf8');const r=parse(h,url(h));
 assert.equal(r.price.kind,'published_auction_amount');assert.equal(r.price.amountJpy,r.price.displayAmountJpy);
 assert.equal(r.specifications.fuel,'gasoline');assert.equal(r.issues.length,0);assert.equal(r.price.saleConfirmed,false);
 assert.ok(r.imageUrls.length>=2);assert.ok(r.calculationBlockers.includes('exact_engine_displacement_required'));
 }
});
test('fuel code map is backed by the public source calculator options',()=>{
 const h=fs.readFileSync(new URL('fuel-codes.html',dir),'utf8');
 for(const [code,label]of [['b','Бензин'],['d','Дизель'],['be','Бензин и Электро'],['de','Дизель и Электро'],['e','Электро']])
 assert.ok(h.includes(`<option value="${code}">${label}</option>`));
});
test('hybrid keeps ICE and motor power separate; combined p never overwrites ICE',()=>{
 const h=fixture('30162144');const r=parse(h,url(h));
 assert.equal(r.specifications.reportedCombustionPowerHp,110);assert.equal(r.specifications.motorPeakKw,22);
 assert.equal(r.specifications.claimedMotor30MinKw,11);assert.equal(r.specifications.calculatorCombinedPowerHp,125.13);
 assert.equal(r.specifications.powertrain,'hybrid');assert.ok(r.calculationBlockers.includes('certified_motor_power_required'));
});
test('reject changed identity, duplicate inputs and mismatched source prices',()=>{
 assert.throws(()=>parse(base,url(base).replace('30162134','9')),/identity/);
 assert.throws(()=>parse(base.replace('name="price" class="calc-input-new" value="2769000"','name="price" class="calc-input-new" value="1"'),url(base)),/price/);
 assert.throws(()=>parse(base.replace('</form>','<input name="price" value="1"></form>'),url(base)),/duplicate_input/);
 assert.throws(()=>parse(base.replace('name="year" value="2025"','name="year" value="2015"'),url(base)),/identity/);
});
test('related content cannot supply price, fields or pictures',()=>{
 const r=parse(base+'<span class="car-info__label">Мощность</span><span class="car-info__value">999 л.с.</span><a href="https://x/photo" data-fancybox="gallery">other</a>',url(base));
 assert.equal(r.specifications.reportedCombustionPowerHp,156);assert.ok(!r.imageUrls.includes('https://x/photo'));
 assert.throws(()=>parse(base.replace('name="price"','name="removed"')+'<input name="price" value="2769000">',url(base)),/price/);
});
test('unknown fuel and conflicting power fail closed; FAT is not asserted to be AT or CVT',()=>{
 assert.ok(parse(base.replace('name="m" value="b"','name="m" value="unknown"'),url(base)).issues.includes('fuel_code_unknown'));
 assert.ok(parse(base.replace('114.7 кВт','200 кВт'),url(base)).issues.includes('power_hp_kw_conflict'));
 assert.equal(parse(base,url(base)).specifications.transmission,null);
});
test('auction sheet is separate from car photos, bound to the same lot, and excludes help samples',()=>{
 const h=fixture('30222301'),r=parse(h,url(h));
 assert.equal(r.specifications.reportedCombustionPowerHp,140);assert.equal(r.specifications.reportedCombustionPowerKw,103);
 assert.equal(r.imageUrls.length,2);assert.equal(r.auctionSheetUrls.length,1);assert.match(r.auctionSheetUrls[0],/1789240244\.7722_1.webp$/);
 const foreign=h.replace('1881816550/1789240244.7722','9999999999/1789240244.7722');
 assert.equal(parse(foreign,url(h)).auctionSheetUrls.length,0);
});
