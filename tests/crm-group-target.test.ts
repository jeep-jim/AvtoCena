import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Standalone runner helper is JavaScript.
import { verifyGroupTarget } from '../scripts/lib/crm-group-target.mjs';
import target from '../apps/web/lib/crm-group-target.json';

test('group verification refuses wrong ID, title, public group, non-group and removed bot', async () => {
  const me = {id: 77};
  const chat = {id: Number(target.chatId), title: target.title, type: 'group'};
  const member = {status: 'member', user: me};
  const check = (c: any, m: any = member) => verifyGroupTarget(async (method: string) => ({result: method === 'getChat' ? c : m}), me, target);
  await check(chat);
  for (const change of [{id: -1}, {title: 'Another team'}, {type: 'private'}, {username: 'public'}, {active_usernames: ['public']}, {permissions: {can_send_messages: false}}]) {
    await assert.rejects(check({...chat, ...change}));
  }
  await assert.rejects(check(chat, {...member, status: 'left'}));
  await assert.rejects(check(chat, {...member, user: {id: 88}}));
});
