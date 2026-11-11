import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePoints,replayPointer,pageKind} from '../controls.mjs';
test('human challenge stays visible; explicit access denial is terminal',()=>{
 assert.equal(pageKind('https://yandex.ru/showcaptcha','Подтвердите, что вы не робот'),'challenge');
 assert.equal(pageKind('https://yandex.ru/search/','Подтвердите, что вы не робот'),'challenge');
 assert.equal(pageKind('https://yandex.ru/search/','Доступ заблокирован'),'blocked');
 assert.equal(pageKind('https://yandex.ru/search/','Характеристики Honda Fit'),'page');
});
test('pointer rejects invalid or oversized paths before any browser input',async()=>{
 let touched=false;const page={mouse:{click(){touched=true;}}};
 for(const points of [[],[{x:-1,y:0}],[{x:420,y:0}],[{x:0,y:640}],[{x:NaN,y:2}],Array(33).fill({x:1,y:1})]){
  await assert.rejects(replayPointer(page,points),/invalid_pointer/);
 }
 assert.equal(touched,false);
 assert.deepEqual(validatePoints([{x:2,y:3,other:'discard'}]),[{x:2,y:3}]);
});
test('only supplied pointer path is replayed and mouse is released on interruption',async()=>{
 const events=[];const page={mouse:{move:async(x,y)=>{events.push(['move',x,y]);if(x===3)throw Error('closed');},down:async()=>events.push(['down']),up:async()=>events.push(['up'])}};
 await assert.rejects(replayPointer(page,[{x:1,y:2},{x:3,y:4}]),/closed/);
 assert.deepEqual(events,[['move',1,2],['down'],['move',3,4],['up']]);
});
