import test from 'node:test';
import assert from 'node:assert/strict';
import {jptradeSavedOffer} from '../apps/web/lib/catalog/jptrade-saved-import';
import {japanAuctionSoldPriceVerified} from '../apps/web/lib/catalog/public-priority';
import {isAllowedCatalogSourceUrl,isAllowedCatalogSourceId} from '../apps/web/lib/catalog/required-catalog-sources';
const now=Date.parse('2026-09-17T06:00:00Z');
function fixture(){
 const urls=[2,3].map(i=>`https://jp2.pa-server.ru/auc_auto/2026_09_14/12345/123_${i}.webp`);
 const row={source:'jptrade',sourceId:'12345',sourceUrl:'https://jptrade.ru/stat/12345',make:'Honda',model:'N-Box',year:2021,priceJpy:1058000,statusRaw:'продано',auctionDate:'2026-09-14',auctionName:'Honda Sendai',lotNumber:'40145',engineCc:660,grade:'4',imageUrls:urls,evidenceSha256:'a'.repeat(64)};
 const checked={sourceId:row.sourceId,sourceUrl:row.sourceUrl,images:urls.map((url,i)=>({url,decodedSha256:String(i+1).repeat(64),size:[1024,768]}))};
 return {row,checked};
}
test('saved sold result preserves source amount and grade without inventing engine or horsepower',()=>{
 const {row,checked}=fixture();const offer=jptradeSavedOffer(row,checked,now)!;
 assert.ok(offer);assert.equal(offer.sourcePrice,1058000);assert.equal(offer.auctionGrade,'4');
 assert.equal(offer.engineCc,undefined);assert.equal(offer.powerHp,undefined);assert.equal(offer.totalRub,null);
 assert.equal(japanAuctionSoldPriceVerified(offer),true);assert.equal(offer.images.length,2);
 assert.equal(isAllowedCatalogSourceId('japan',offer.sourceId),true);
 assert.equal(isAllowedCatalogSourceUrl('japan',offer.sourceId,offer.operational.sourceUrl),true);
 for(const url of ['https://jptrade.ru/stat/','https://jptrade.ru/current/12345','https://evil.jptrade.ru/stat/12345'])assert.equal(isAllowedCatalogSourceUrl('japan',offer.sourceId,url),false);
});
test('reject incomplete, unsold, stale or mismatched source and image evidence',()=>{
 for(const patch of [{statusRaw:'не продано'},{priceJpy:0},{auctionDate:'2026-07-01'},{auctionDate:'2026-09-18'},{sourceUrl:'https://jptrade.ru/stat/999'},{lotNumber:''}]) {
  const {row,checked}=fixture();assert.equal(jptradeSavedOffer({...row,...patch},checked,now),null);
 }
 for(const mode of ['identity','duplicate','unbound','sheet','directory']) {
  const {row,checked}=fixture();
  if(mode==='identity')checked.sourceId='999';
  if(mode==='duplicate')checked.images[1].decodedSha256=checked.images[0].decodedSha256;
  if(mode==='unbound')checked.images[1].url='https://example.org/other.webp';
  if(mode==='sheet')(row as any).auctionSheetUrls=[checked.images[1].url];
  if(mode==='directory'){checked.images[1].url=checked.images[1].url.replace('/12345/','/999/');row.imageUrls[1]=checked.images[1].url;}
  assert.equal(jptradeSavedOffer(row,checked,now),null,mode);
 }
});
