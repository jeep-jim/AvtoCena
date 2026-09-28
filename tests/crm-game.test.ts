import test from 'node:test';
import assert from 'node:assert/strict';
import {beginGame,finishGame,gameBest,validateGameResult} from '../apps/web/lib/crm-game';
import {getJsonStorage} from '../apps/web/lib/data';
test('game score is computed on the server and rejects impossible results',()=>{
 assert.equal(validateGameResult({distance:100,coins:2,kills:1,duration:10,score:999999},'battle',11).score,650);
 assert.equal(validateGameResult({distance:3000,coins:0,kills:0,duration:60},'circuit',61).score,4200);
 assert.throws(()=>validateGameResult({distance:100000,coins:0,kills:0,duration:10},'hills',11));
 assert.throws(()=>validateGameResult({distance:100,coins:0,kills:0,duration:100},'hills',11));
 assert.throws(()=>validateGameResult({distance:100,coins:1,kills:0,duration:10},'circuit',11));
 assert.throws(()=>validateGameResult({distance:-1,coins:0,kills:0,duration:10},'hills',11));
});
test('each user has separate records; finishing twice cannot duplicate points',async()=>{
 const id='game-test-'+Date.now();
 try{
  const run=await beginGame(id,'hills',100000);
  await assert.rejects(beginGame(id,'circuit',101000),/too_many_runs/);
  const input={runId:run.id,distance:100,coins:2,kills:0,duration:10};
  const result=await finishGame(id,input,111000);
  assert.equal(result.score,150);
  assert.deepEqual(await finishGame(id,input,112000),result);
  assert.equal((await gameBest(id)).hills?.score,150);
  await assert.rejects(finishGame(id+'-other',input,111000),/run_expired/);
  const next=await beginGame(id,'hills',120000);
  await finishGame(id,{...input,runId:next.id,distance:10,coins:0},131000);
  assert.equal((await gameBest(id)).hills?.score,150);
 }finally{await getJsonStorage().deleteJson?.(`games/pognali/v1/${id}.json`);}
});
