import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Sessions} from '../sessions.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(options={}) {let now=0,closed=0; const sessions=new Sessions({now:()=>now,open:async()=>({start:async()=>{},close:async()=>{closed++},frame:async()=>Buffer.from('frame'),send:async()=>{},scroll:async()=>{}}),...options});return {sessions,setTime:n=>{now=n},closed:()=>closed};}
test('lost heartbeat destroys session even while no close request arrives',async()=>{const h=harness(),id=randomUUID();h.sessions.create('a',id,'prompt');await tick();h.setTime(20001);await h.sessions.sweep();assert.equal(h.closed(),1);assert.equal(h.sessions.rows.size,0);assert.equal(h.sessions.permits.size,0);});
test('heartbeats cannot keep an idle browser alive',async()=>{const h=harness(),id=randomUUID();h.sessions.create('a',id,'prompt');await tick();for(let t=10000;t<=90000;t+=10000){h.setTime(t);h.sessions.heartbeat('a',id);await h.sessions.sweep();}assert.equal(h.closed(),1);});
test('active conversation still expires at hard lifetime',async()=>{const h=harness({lifeMs:50000}),id=randomUUID();h.sessions.create('a',id,'prompt');await tick();for(let t=10000;t<=50000;t+=10000){h.setTime(t);h.sessions.heartbeat('a',id);await h.sessions.act('a',id,'send',{text:'x'});await h.sessions.sweep();}assert.equal(h.closed(),1);});
test('closing during launch retains capacity until launched browser is destroyed',async()=>{let release,closed=0;const sessions=new Sessions({max:1,open:()=>new Promise(resolve=>{release=()=>resolve({close:async()=>{closed++}});})});const id=randomUUID();sessions.create('a',id,'x');await sessions.close('a',id);assert.throws(()=>sessions.create('b',randomUUID(),'x'),/pilot_busy/);release();await tick();assert.equal(closed,1);assert.equal(sessions.permits.size,0);});
test('close before create is terminal and another owner cannot operate a session',async()=>{const h=harness(),id=randomUUID();await h.sessions.close('a',id);assert.throws(()=>h.sessions.create('a',id,'x'),/session_closed/);const other=randomUUID();h.sessions.create('a',other,'x');await tick();await assert.rejects(h.sessions.close('b',other),/session_not_found/);assert.throws(()=>h.sessions.heartbeat('b',other),/session_not_found/);await h.sessions.shutdown();assert.equal(h.closed(),1);});
test('first frame works at zero clock and subsequent frames are limited',async()=>{const h=harness(),id=randomUUID();h.sessions.create('a',id,'x');await tick();assert.ok(Buffer.isBuffer(await h.sessions.act('a',id,'frame')));await assert.rejects(h.sessions.act('a',id,'frame'),/frame_rate_limit/);await h.sessions.shutdown();});
test('a provider block closes the browser and stops subsequent requests',async()=>{let closed=0;const s=new Sessions({open:async()=>({start:async()=>{},frame:async()=>{throw Error('provider_blocked')},close:async()=>{closed++}})}),id=randomUUID();s.create('a',id,'x');await tick();await assert.rejects(s.act('a',id,'frame'),/provider_blocked/);assert.equal(closed,1);assert.equal(s.rows.size,0);});

test('manual controls remain owner-bound and an unanswered challenge expires',async()=>{
 let now=0,closed=0,clicks=0,inputs=0;
 const s=new Sessions({now:()=>now,open:async()=>({start:async()=>{},info:()=>({view:'challenge'}),interact:async()=>clicks++,input:async()=>inputs++,close:async()=>closed++})});
 const id=randomUUID();s.create('owner',id,'x');await tick();
 assert.equal(s.heartbeat('owner',id).view,'challenge');
 await assert.rejects(s.act('other',id,'interact',{points:[{x:1,y:1}]}),/session_not_found/);
 await s.act('owner',id,'interact',{points:[{x:1,y:1}]});
 await s.act('owner',id,'input',{text:'human text',submit:true});
 assert.equal(clicks,1);assert.equal(inputs,1);
 now=20001;await s.sweep();assert.equal(closed,1);assert.equal(s.rows.size,0);
});
