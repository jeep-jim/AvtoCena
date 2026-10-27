import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertInteractionAcceptance} from './browser/catalog-interaction-acceptance.mjs';
const sha='a'.repeat(40);
const rows=()=>[390,1440].map(width=>({width,release:sha,categoryMs:100,filterMs:200,cards:24,feedback:{samples:1,emptyCards:false,headerVisible:false},errors:[]}));
test('accepts both widths with correct visible results within the existing ceiling',()=>assertInteractionAcceptance(rows(),sha));
test('a green functional result cannot hide the observed slow Korea baseline',()=>{const r=rows();r[0].filterMs=20537;r[0].withinTarget={filter:true};assert.throws(()=>assertInteractionAcceptance(r,sha),/20537ms/);});
test('missing width, different runtime and empty results are not accepted',()=>{assert.throws(()=>assertInteractionAcceptance(rows().slice(0,1),sha));for(const patch of [{release:'b'.repeat(40)},{cards:0},{categoryMs:NaN}]){const r=rows();Object.assign(r[1],patch);assert.throws(()=>assertInteractionAcceptance(r,sha));}});
test('retention, pending observation, loader and JavaScript errors are mandatory',()=>{for(const patch of [{feedback:{samples:0,emptyCards:false,headerVisible:false}},{feedback:{samples:2,emptyCards:true,headerVisible:false}},{feedback:{samples:2,emptyCards:false,headerVisible:true}},{errors:['render failed']}]){const r=rows();Object.assign(r[0],patch);assert.throws(()=>assertInteractionAcceptance(r,sha));}});
