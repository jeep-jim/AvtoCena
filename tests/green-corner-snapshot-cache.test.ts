import test from 'node:test';
import assert from 'node:assert/strict';
import {getJsonStorage} from '../apps/web/lib/data';
import {readGreenCorner, GREEN_CORNER_PATH} from '../apps/web/lib/catalog/green-corner';

test('stock readers share the validated snapshot, refresh after a minute, and reject invalid replacements',async t=>{
 let now=Date.now(),reads=0;
 let value:any={version:1,updatedAt:'first',sourceCount:0,items:[]};
 t.mock.method(Date,'now',()=>now);
 t.mock.method(getJsonStorage(),'readJson',async(path:string)=>{
  assert.equal(path,GREEN_CORNER_PATH);reads++;
  await new Promise(resolve=>setImmediate(resolve));return value;
 });
 const first=await Promise.all(Array.from({length:12},()=>readGreenCorner()));
 assert.equal(reads,1);assert.ok(first.every(item=>item===first[0]));
 now+=59999;assert.equal(await readGreenCorner(),first[0]);assert.equal(reads,1);
 value={version:1,updatedAt:'second',sourceCount:0,items:[]};now+=2;
 assert.equal((await readGreenCorner()).updatedAt,'second');assert.equal(reads,2);
 value={version:2,updatedAt:'invalid',sourceCount:0,items:[]};now+=60001;
 await assert.rejects(readGreenCorner(),/green_invalid_snapshot/);
 value={version:1,updatedAt:'recovered',sourceCount:0,items:[]};
 assert.equal((await readGreenCorner()).updatedAt,'recovered');
});
