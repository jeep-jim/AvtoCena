import assert from 'node:assert/strict';
import test from 'node:test';
import { isExistingPilotBridgeRequest } from '../scripts/lib/catalog-pilot-bridge.mjs';

test('production bridge diagnostics admit only three exact one-page read routes', () => {
  const url = new URL('https://avtocena.com/api/internal/encar-egress-71b8e4?page=1');
  assert.equal(isExistingPilotBridgeRequest(url, 'GET', 'encar_direct'), true);
  assert.equal(isExistingPilotBridgeRequest(url, 'GET', 'guazi_china_open'), false);
  assert.equal(isExistingPilotBridgeRequest(url, 'POST', 'encar_direct'), false);
  for (const value of [url.href.replace('page=1', 'page=2'), url.href + '&publish=1',
    url.href.replace('avtocena.com', 'evil.avtocena.com'), url.href.replace('/encar-egress-71b8e4', '/admin'),
    url.href.replace('https:', 'http:')]) assert.equal(isExistingPilotBridgeRequest(new URL(value), 'GET', 'encar_direct'), false);
  assert.equal(isExistingPilotBridgeRequest(new URL('https://avtocena.com/api/internal/guazi-egress-b8c4d1?page=1'), 'GET', 'guazi_china_open'), true);
  assert.equal(isExistingPilotBridgeRequest(new URL('https://avtocena.com/api/internal/georgia-recovery-e2f913?source=myauto&pages=1&startPage=1'), 'GET', 'myauto_georgia_list'), true);
});
