import test from 'node:test';
import assert from 'node:assert/strict';
import {requestPushPermission,pushPermissionMessage} from '../apps/web/lib/push-permission';

test('desktop permission prompt starts in the click stack, before the first await',async()=>{
  let called=false;
  const result=requestPushPermission({permission:'default',requestPermission:()=>{called=true;return Promise.resolve('granted');}});
  assert.equal(called,true);
  assert.equal(await result,'granted');
});
test('an existing grant enables the subscription path without another browser prompt',async()=>{
  assert.equal(await requestPushPermission({permission:'granted',requestPermission:()=>{throw Error('must not prompt again');}}),'granted');
});
test('a dismissed prompt stays retryable and is not presented as a browser block',async()=>{
  const permission=await requestPushPermission({permission:'default',requestPermission:()=>Promise.resolve('default')});
  assert.equal(permission,'default');
  assert.match(pushPermissionMessage(permission),/Нажмите кнопку снова/);
  assert.doesNotMatch(pushPermissionMessage(permission),/настройк|заблокир/);
});
test('a stored browser denial is respected rather than repeatedly prompting or claiming success',async()=>{
  const permission=await requestPushPermission({permission:'denied',requestPermission:()=>{throw Error('must not prompt after a denial');}});
  assert.equal(permission,'denied');
  assert.match(pushPermissionMessage(permission),/заблокировал/);
  assert.equal(pushPermissionMessage('granted'),'');
});
