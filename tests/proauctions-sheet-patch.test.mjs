import test from 'node:test';
import assert from 'node:assert/strict';
import {assertJapanSheetIdentity} from '../scripts/lib/proauctions-sheet-patch.mjs';
const photo='https://jp2.pa-server.ru/auc_auto/2026_09_17/123456/1.webp';
const row={sourceId:'proauctions_japan_stat',sourceOfferId:'123',sourcePrice:400000,year:2023,lotNumber:'456',auctionDate:'2026-09-17',operational:{sourceUrl:'https://demo.pro-auctions.ru/statistika/toyota/yaris/123.html'},images:[{url:photo}]};
const e={sourceId:'123',sourceUrl:row.operational.sourceUrl,price:{amountJpy:400000},identity:{year:2023,lotNumber:'456',auctionDate:'2026-09-17'},auctionSheetUrls:[photo.replace('1.webp','2.webp')],issues:[]};
test('live sheet requires the published identity, price and existing gallery directory',()=>{
 assertJapanSheetIdentity(row,e);
 for(const k of ['sourceOfferId','sourcePrice','year','lotNumber','auctionDate'])assert.throws(()=>assertJapanSheetIdentity({...row,[k]:'wrong'},e),/identity/);
 assert.throws(()=>assertJapanSheetIdentity(row,{...e,sourceUrl:e.sourceUrl+'?other'}),/identity/);
 assert.throws(()=>assertJapanSheetIdentity(row,{...e,auctionSheetUrls:[photo.replace('/123456/','/999999/')]}),/gallery/);
 assert.throws(()=>assertJapanSheetIdentity(row,{...e,issues:['gallery_identity_unconfirmed']}),/gallery/);
 assert.deepEqual(row.images,[{url:photo}]);
});
