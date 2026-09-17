import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseProAuctionsDetailEvidence} from '../apps/web/lib/catalog/proauctions-detail-evidence';
import {matchingProAuctionsSale,proAuctionsIdentity,proAuctionsOffer} from '../apps/web/lib/catalog/proauctions-import';
import {japanAuctionSoldPriceVerified} from '../apps/web/lib/catalog/public-priority';
import {isAllowedCatalogSourceUrl} from '../apps/web/lib/catalog/required-catalog-sources';
import {enrichOfferWithSourceTableDisplacement} from '../apps/web/lib/catalog/source-table-displacement';
const now=Date.parse('2026-09-17T12:00:00Z');
const url='https://demo.pro-auctions.ru/statistika/mazda/cx-5/30162134.html';
const html=fs.readFileSync('tests/fixtures/proauctions/30162134.html','utf8');
function fixture(){
 const e=parseProAuctionsDetailEvidence(html,url),identity={make:'Mazda',model:'CX-5'};
 const witness={source:'jptrade',sourceId:'30162134',sourceUrl:'https://jptrade.ru/stat/30162134',statusRaw:'продано',
   ...identity,...e.identity,priceJpy:e.price.amountJpy,evidenceSha256:'a'.repeat(64)};
 const photos=e.imageUrls.map((url,i)=>({url,decodedSha256:String(i+1).repeat(64),width:1024,height:768,size:20000,mimeType:'image/webp'}));
 return {e,identity,witness,photos};
}
test('only a complete matching sold witness permits auction publication',()=>{
 const {e,identity,witness,photos}=fixture();
 assert.equal(proAuctionsOffer(e,identity,null,photos,'b'.repeat(64),now),null);
 assert.equal(matchingProAuctionsSale(e,identity,witness),true);
 for(const change of [{statusRaw:'не продано'},{priceJpy:100},{lotNumber:'other'},{chassis:'OTHER'},{year:2020},{make:'Toyota'},{auctionDate:'2026-09-14'}])
  assert.equal(proAuctionsOffer(e,identity,{...witness,...change},photos,'b'.repeat(64),now),null);
});
test('incomplete specifications remain publishable without a fabricated total or exact displacement',()=>{
 const {e,identity,witness,photos}=fixture();
 const offer=proAuctionsOffer(e,identity,witness,photos,'b'.repeat(64),now)!;
 assert.ok(offer);assert.equal(offer.sourcePrice,e.price.amountJpy);assert.equal(offer.totalRub,null);
 assert.equal(offer.engineCc,undefined);assert.equal(enrichOfferWithSourceTableDisplacement(offer).engineCc,undefined);
 assert.equal(offer.operational.sourceUrl,url);assert.equal(japanAuctionSoldPriceVerified(offer),true);
 assert.ok(offer.operational.sourceSpecifications?.groups[0].items.some(x=>x.name==='Объем, см³'&&x.value==='2000'));
 e.issues.push('power_hp_kw_conflict');
 const conflicted=proAuctionsOffer(e,identity,witness,photos,'b'.repeat(64),now)!;
 assert.ok(conflicted);assert.equal(conflicted.powerHp,undefined);assert.equal(conflicted.totalRub,null);
});
test('gallery identity, image decoding and retention cannot be bypassed',()=>{
 const {e,identity,witness,photos}=fixture();
 for(const bad of [photos.slice(0,1),photos.map(p=>({...p,decodedSha256:'a'.repeat(64)})),photos.map(p=>({...p,url:'https://example.org/img.webp'}))])
  assert.equal(proAuctionsOffer(e,identity,witness,bad,'b'.repeat(64),now),null);
 assert.equal(proAuctionsOffer(e,identity,witness,photos,'b'.repeat(64),now+60*86400000),null);
});
test('allowlist restricts source links to canonical statistics details',()=>{
 assert.equal(isAllowedCatalogSourceUrl('japan','proauctions_japan_stat',url),true);
 for(const bad of ['https://demo.pro-auctions.ru/auction/123.html',url+'?x=1',url.replace('demo.','evil.'),url.replace('https:','http:')])
  assert.equal(isAllowedCatalogSourceUrl('japan','proauctions_japan_stat',bad),false);
});
test('breadcrumb identity must agree with primary title',()=>{
 const {e}=fixture();
 const crumbs=['ProAuctions','Статистика','Mazda','CX-5'].map(x=>`<span itemprop="name">${x}</span>`).join('');
 assert.deepEqual(proAuctionsIdentity(crumbs+html,e),{make:'Mazda',model:'CX-5'});
 assert.throws(()=>proAuctionsIdentity(crumbs.replace('Mazda','Toyota')+html,e),/identity/);
});
