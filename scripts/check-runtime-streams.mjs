import assert from 'node:assert/strict';
import {TransformStream} from 'node:stream/web';
import {setTimeout} from 'node:timers/promises';

// Regression scenario: nodejs/node#62036, fixed by nodejs/node#62040.
// A visitor leaving during streamed HTML must not trigger an internal TypeError.
for(let attempt=0;attempt<25;attempt++){
 const stream=new TransformStream({transform(chunk,controller){controller.enqueue(chunk);}});
 await setTimeout(0);
 const reader=stream.readable.getReader(),writer=stream.writable.getWriter();
 const read=reader.read();
 const cancel=reader.cancel(new Error('client disconnected'));
 const write=writer.write('late HTML');
 const results=await Promise.allSettled([read,cancel,write]);
 assert.equal(results[0].status,'fulfilled');
 assert.equal(results[1].status,'fulfilled');
 for(const result of results)if(result.status==='rejected'){
  assert.doesNotMatch(String(result.reason),/transformAlgorithm is not a function/);
 }
}
console.log(JSON.stringify({runtime:process.version,streamCancelWriteChecks:25,ok:true}));
