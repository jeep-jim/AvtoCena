import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

test('calculated stock retains availability while auctions retain auction badges',()=>{
 const output=execFileSync(process.execPath,['--import','tsx','-e',`
  const React=require('react');globalThis.React=React;
  const {renderToStaticMarkup}=require('react-dom/server');
  const {CatalogPrice}=require('./apps/web/components/catalog/CatalogPrice');
  const offer={id:'green-123',sourceId:'akebono_green_japan_open',offerType:'fixed',market:'japan',totalRub:1200000,fuel:'petrol',auctionGrade:'4',calculationStatus:'calculated'};
  const render=offer=>renderToStaticMarkup(React.createElement(CatalogPrice,{offer,label:'2026 г.'}));
  const automatic={...offer,totalRub:null,sourcePrice:1000,sourceCurrency:'JPY',catalogPricingMode:'seller',sellerPriceRub:500,calculationStatus:'needs_data',calculationSnapshot:{currencyRate:{currency:'JPY',effectiveRate:.5,sourcePrice:1000,sourcePriceRub:500}},japanDeliveredPreview:{totalRub:1500000,currencyRate:{currency:'JPY',effectiveRate:.5,previousEffectiveRate:.6,rateDate:'2026-09-22',previousRateDate:'2026-09-19'}}};
  console.log(JSON.stringify({stock:render(offer),automatic:render(automatic),auction:render({...offer,id:'auction-123',sourceId:'auction',offerType:'auction'})}));
 `],{encoding:'utf8',env:{...process.env,TSX_TSCONFIG_PATH:'apps/web/tsconfig.json'}});
 const {stock,automatic,auction}=JSON.parse(output);
 assert.match(stock,/В наличии/);assert.doesNotMatch(stock,/Лот продан/);assert.match(stock,/1\s200\s000/);
 assert.match(automatic,/1\s500\s000/);assert.match(automatic,/ac-price--down/);assert.doesNotMatch(automatic,/Лот продан/);
 for(const html of [stock,automatic]){assert.match(html,/Оценка 4/);assert.doesNotMatch(html,/ac-price-trend-arrow|ac-price-trend-delta/);}
 assert.match(auction,/Лот продан/);
});
