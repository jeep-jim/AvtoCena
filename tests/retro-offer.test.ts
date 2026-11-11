import test from 'node:test';
import assert from 'node:assert/strict';
import {isRetroOffer} from '../apps/web/lib/catalog/retro-offer';
test('retro presentation includes historic production years through 1989',()=>{
 for(const year of [1886,1920,1965,1989,'1989'])assert.equal(isRetroOffer({year}),true);
});
test('1990 and later remain in the regular presentation',()=>{
 for(const year of [1990,2008,2014,2026])assert.equal(isRetroOffer({year}),false);
});
test('unknown or invalid years do not invent retro identity',()=>{
 for(const year of [undefined,null,'',0,1800,1989.5,'unknown',NaN])assert.equal(isRetroOffer({year}),false);
 assert.equal(isRetroOffer(null),false);
});
