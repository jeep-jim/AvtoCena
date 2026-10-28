import test from 'node:test';
import assert from 'node:assert/strict';
import {modelDirectoryMarkets} from '../apps/web/lib/catalog/market-selection';
test('model directories follow every selected source market without enabling China reserves',()=>{
 assert.deepEqual(modelDirectoryMarkets('korea','Hyundai'),['korea']);
 assert.deepEqual(modelDirectoryMarkets('china|korea','Hyundai'),['korea']);
 assert.deepEqual(modelDirectoryMarkets('japan|korea','Toyota'),['japan','korea']);
 assert.deepEqual(modelDirectoryMarkets('china|korea','Toyota',true),['china','korea']);
 for(const market of ['europe','uae','georgia','green'])assert.deepEqual(modelDirectoryMarkets(market,'Toyota'),[]);
 assert.deepEqual(modelDirectoryMarkets('','Hyundai'),['korea','japan']);
 assert.deepEqual(modelDirectoryMarkets('',''),[]);
});
