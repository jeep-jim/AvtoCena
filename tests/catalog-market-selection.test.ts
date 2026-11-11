import test from 'node:test';
import assert from 'node:assert/strict';
import {selectedCatalogMarkets,marketSelectionUrl} from '../apps/web/lib/catalog/market-selection';
import {selectionQuery} from '../apps/web/lib/dealers/selection-share';
test('multiple markets survive dealer selection links without confusing Japanese stock and auctions',()=>{
 const url=new URL('https://avtocena.com/cars?market=china%7Cjapan%7Cgreen&make=Toyota&city=Новокузнецк&source=old');
 assert.deepEqual(selectedCatalogMarkets(url.searchParams.get('market')),['china','japan','green']);
 assert.equal(selectionQuery(url.searchParams,false).get('market'),'china|japan|green');
 const stock=marketSelectionUrl(url,'green'),auction=marketSelectionUrl(stock,'japan');
 assert.equal(stock.searchParams.get('stock'),'green');assert.equal(stock.searchParams.get('market'),'japan');
 assert.equal(auction.searchParams.has('stock'),false);assert.equal(auction.searchParams.has('source'),false);
 assert.equal(auction.searchParams.get('make'),'Toyota');assert.equal(auction.searchParams.get('city'),'Новокузнецк');
 assert.deepEqual(selectedCatalogMarkets('china|china|invalid|uae'),['china','uae']);
});
