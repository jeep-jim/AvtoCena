import test from 'node:test';
import assert from 'node:assert/strict';
import {publicAnswerText} from '../apps/web/lib/autobot/public-answer';
test('customer reply hides debug vocabulary without changing prices',()=>{
 const text=publicAnswerText('calculationStatus = needs_data; totalRub = null; readPages=0. Цена 165480 ₽.');
 assert.doesNotMatch(text,/calculationStatus|needs_data|totalRub|readPages|null/);assert.match(text,/165480 ₽/);
});
