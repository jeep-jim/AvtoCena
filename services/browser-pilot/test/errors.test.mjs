import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnosis,stage} from '../errors.mjs';
test('diagnostic only exposes stage and categorical network code',()=>{
 const e=new Error('page.goto: net::ERR_NAME_NOT_RESOLVED at https://example.invalid/?token=secret user prompt');
 assert.deepEqual(diagnosis('navigate',e),{stage:'navigate',code:'ERR_NAME_NOT_RESOLVED'});
 assert.equal(JSON.stringify(diagnosis('navigate',e)).includes('secret'),false);
});
test('stage preserves provider block for terminal cleanup',async()=>{
 const error=Error('provider_blocked');
 await assert.rejects(stage('check',async()=>{throw error;}),e=>e===error&&e.diagnostic.code==='provider_blocked');
});
test('launch sandbox and timeout failures remain distinguishable',()=>{
 assert.equal(diagnosis('launch',Error('Operation not permitted')).code,'sandbox_unavailable');
 const e=Error('private text');e.name='TimeoutError';
 assert.deepEqual(diagnosis('submit',e),{stage:'submit',code:'timeout'});
});
