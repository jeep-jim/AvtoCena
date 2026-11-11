import assert from 'node:assert/strict';
import test from 'node:test';
import {serializeStorageJson} from '../apps/web/lib/data';

test('catalog serialization preserves every field without pretty-print growth', () => {
  const row = {id:'example',name:'Комплектация 北京',specs:Array.from({length:40},(_,i)=>({name:`Поле ${i}`,value:'x'})),missing:undefined};
  const value={generationId:'test',items:Array(2000).fill(row)};
  const compact=serializeStorageJson('catalog/public/projection/all.json',value);
  assert.equal(compact,JSON.stringify(value));
  assert.deepEqual(JSON.parse(compact),JSON.parse(JSON.stringify(value)));
  assert.ok(compact.length < JSON.stringify(value,null,2).length/2);
  assert.equal(serializeStorageJson('settings/test.json',{a:1}),JSON.stringify({a:1},null,2));
});

test('serialization errors identify the exact object and preserve the cause', () => {
  const bad:any={};bad.self=bad;
  assert.throws(()=>serializeStorageJson('catalog/test.json',bad),(error:any)=>
    error.message.startsWith('storage_json_serialize_failed:path=catalog/test.json:') && error.cause instanceof TypeError);
});
