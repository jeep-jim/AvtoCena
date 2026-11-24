import test from 'node:test';
import assert from 'node:assert/strict';
import {modelDirectoryMarkets} from '../apps/web/lib/catalog/market-selection';
test('only Japan adds an AJ directory to model suggestions',()=>{
 assert.deepEqual(modelDirectoryMarkets('korea','Hyundai'),[]);
 assert.deepEqual(modelDirectoryMarkets('china|korea','Hyundai'),[]);
 assert.deepEqual(modelDirectoryMarkets('japan|korea','Toyota'),['japan']);
 assert.deepEqual(modelDirectoryMarkets('china|korea','Toyota',true),[]);
 for(const market of ['europe','uae','georgia','green'])assert.deepEqual(modelDirectoryMarkets(market,'Toyota'),[]);
 assert.deepEqual(modelDirectoryMarkets('','Hyundai'),['japan']);
 assert.deepEqual(modelDirectoryMarkets('',''),[]);
});
