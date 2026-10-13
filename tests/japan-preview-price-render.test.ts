import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {priceCardForCity} from '../apps/web/lib/catalog/card-city-delivery';

test('Japanese calculated previews show quote and truthful red/green trend, keeping auction grade', () => {
 const output = execFileSync(process.execPath, ['--import','tsx','-e',`
  const React=require('react');globalThis.React=React;
  const {renderToStaticMarkup}=require('react-dom/server');
  const {CatalogPrice}=require('./apps/web/components/catalog/CatalogPrice');
  const {offerWithSavedPreview}=require('./apps/web/lib/catalog/saved-calculation-preview');
  const render=offer=>renderToStaticMarkup(React.createElement(CatalogPrice,{offer,label:'2020 г.'}));
  const offer={market:'japan',sourceCurrency:'JPY',sourcePrice:1000000,catalogPricingMode:'seller',sellerPriceRub:500000,totalRub:null,auctionGrade:'4'};
  const quote=delta=>({totalRub:1500000,currencyRate:{currency:'JPY',rateSource:'bank',sourcePrice:1000000,effectiveRate:.5,previousEffectiveRate:.5-delta,rateDate:'2026-10-13',previousRateDate:'2026-10-12'}});
  console.log(JSON.stringify({down:render({...offer,japanDeliveredPreview:quote(-.01)}),up:render({...offer,japanDeliveredPreview:quote(.01)}),flat:render({...offer,japanDeliveredPreview:quote(0)}),saved:render(offerWithSavedPreview({...offer,savedCalculationPreview:{...quote(-.01),version:'v1',parameters:{}}})),missing:render(offer)}));
 `], {encoding:'utf8',env:{...process.env,TSX_TSCONFIG_PATH:'apps/web/tsconfig.json'}});
 const html=JSON.parse(output);
 for(const key of ['down','up','flat','saved']) {assert.match(html[key],/1\s500\s000/); assert.match(html[key],/Оценка 4/);}
 assert.match(html.down,/ac-price--down/);assert.match(html.up,/ac-price--up/);
 assert.match(html.saved,/ac-price--down/);assert.match(html.flat,/ac-price--flat/);
 assert.doesNotMatch(html.missing,/1\s500\s000|ac-price--down|ac-price--up/);
});

test('Japanese city preview preserves quoted rate, clears seller delta and respects saved calculation',()=>{
 const preview={totalRub:1000000,currencyRate:{currency:'JPY',effectiveRate:.5},deliveryPricingBasis:{subtotalRub:1000000,deliveryRub:0,percents:[]}};
 const input={market:'japan',sourcePrice:200000,totalRub:200000,previousTotalRub:190000,priceDeltaRub:10000,japanDeliveredPreview:preview};
 const priced=priceCardForCity(input,'Чита').offer;
 assert.equal(priced.totalRub,1065000);assert.equal(priced.calculationSnapshot.currencyRate,preview.currencyRate);
 assert.equal(priced.previousTotalRub,null);assert.equal(priced.priceDeltaRub,null);
 assert.equal(input.totalRub,200000);
 const saved=priceCardForCity({...input,totalRub:1800000,savedCalculationPreview:{version:'v1'}},'').offer;
 assert.equal(saved.totalRub,1800000);
});
