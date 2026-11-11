import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';

test('deployment retry emits only the complete successful response after a partial timeout', async () => {
  let requests = 0;
  const server = http.createServer((_request, response) => {
    if (++requests === 1) {
      response.writeHead(200, { 'Content-Length': 10000 });
      response.write('partial-response-must-not-escape');
      return;
    }
    response.end('{"ok":true}');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as import('node:net').AddressInfo;
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn('bash', ['-c', 'set -euo pipefail; source "$1"; CURL=(curl --retry 1 --retry-all-errors --retry-delay 0 --max-time 0.15 -fsS); fetch_complete "$2"',
        'test', path.resolve('scripts/lib/curl-complete.sh'), `http://127.0.0.1:${address.port}/`]);
      let stdout = '', stderr = '';
      child.stdout.on('data', data => { stdout += data; });
      child.stderr.on('data', data => { stderr += data; });
      child.on('error', reject);
      child.on('close', code => resolve({ code, stdout, stderr }));
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(requests, 2);
    assert.equal(result.stdout, '{"ok":true}');
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
