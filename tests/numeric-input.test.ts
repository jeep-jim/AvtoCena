import test from 'node:test';
import assert from 'node:assert/strict';
import {numericDraft,formatNumericDraft,numericValue} from '../apps/web/lib/numeric-input';
test('empty input stays empty and numeric storage remains compatible',()=>{
 assert.equal(numericDraft(''),'');assert.equal(formatNumericDraft('',true),'');assert.equal(numericValue(''),0);
 assert.equal(formatNumericDraft('1699000',true),'1 699 000');assert.equal(numericValue(numericDraft('1\u00a0699\u202f000')!),1699000);
});
test('decimal editing keeps separators and rejects invalid numeric text',()=>{
 assert.equal(numericDraft('1 234.50'),'1234,50');assert.equal(formatNumericDraft('1234,',true),'1 234,');assert.equal(numericValue('1234,50'),1234.5);
 assert.equal(formatNumericDraft('-1234,50',true),'-1 234,50');assert.equal(formatNumericDraft('1500',false),'1500');
 for(const text of ['abc','1,2,3','1e3','Infinity'])assert.equal(numericDraft(text),null);
});
