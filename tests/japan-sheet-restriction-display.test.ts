import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { rankedCatalogImageUrls, isLikelyVehicleImage } from '../apps/web/lib/catalog/image-quality';
import { assessJapanExportRestriction, japanRestrictionDescription } from '../apps/web/lib/catalog/japan-export-restriction';
const fixture = () => JSON.parse(fs.readFileSync(new URL('./fixtures/proauctions/published-corolla-cross.json', import.meta.url), 'utf8'));

test('decoded same-lot portrait sheet remains last, including a full photo gallery', () => {
  const offer = fixture();
  offer.images = [2,3].map(n => ({url:`https://jp2.pa-server.ru/auc_auto/2026_09_17/1881816550/1789240244.9749_${n}.webp`, checksum:String(n).repeat(64), width:1024, height:768, size:56434, mimeType:'image/webp'}));
  const sheet = {...offer.images[0], url: offer.images[0].url.replace(/_2\.webp$/, '_1.webp'), width: 700, height: 1000, size: 26000, checksum: 'a'.repeat(64)};
  assert.equal(isLikelyVehicleImage(sheet), false);
  offer.images.unshift(sheet);
  let urls = rankedCatalogImageUrls(offer);
  assert.equal(urls.length, 3);
  assert.equal(urls.at(-1), sheet.url);
  for (let i=4;i<40;i++) offer.images.push({...offer.images[1], url: offer.images[1].url.replace(/_2\.webp$/, `_${i}.webp`), checksum: String(i).padStart(64, '0')});
  urls=rankedCatalogImageUrls(offer);
  assert.equal(urls.length,31);
  assert.equal(urls.at(-1),sheet.url);
  sheet.url=sheet.url.replace('/1881816550/', '/999999/');
  assert.equal(rankedCatalogImageUrls(offer).includes(sheet.url),false);
  sheet.url=offer.images[1].url.replace(/_2\.webp$/, '_1.webp');
  sheet.checksum='';
  assert.equal(rankedCatalogImageUrls(offer).includes(sheet.url),false);
});

test('rounded source volume triggers review without certifying exact displacement', () => {
  const offer=fixture();
  const volume=offer.operational.sourceSpecifications.groups.flatMap((g:any)=>g.items).find((i:any)=>/^Объ[её]м/.test(i.name));
  for (const [cc, status] of [[1800, undefined],[1900,undefined],[2000,'needs_review']]) {
    volume.value=String(cc); offer.operational.semanticEvidence.engineCc.value=cc;
    const result=assessJapanExportRestriction(offer);
    assert.equal(result?.status,status);
    assert.equal(offer.engineCc,undefined);
    if (result) assert.match(japanRestrictionDescription(result),/требуют проверки/);
  }
  offer.operational.semanticEvidence.engineCc.status='conflict';
  assert.equal(assessJapanExportRestriction(offer),undefined);
  offer.operational.semanticEvidence.engineCc.status='ambiguous';
  offer.operational.sourceSpecifications.sourceOfferId='another';
  assert.equal(assessJapanExportRestriction(offer),undefined);
});
