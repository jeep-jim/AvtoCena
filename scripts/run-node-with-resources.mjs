import {spawn} from 'node:child_process';
import {createResourceNodeInvocation} from './lib/node-resource-memory.mjs';

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) throw Error('Usage: node scripts/run-node-with-resources.mjs [node options] script [arguments]');
  const invocation = await createResourceNodeInvocation({args, role:'heavy-node'});
  const child = spawn(process.execPath, invocation.args, {env:invocation.env, stdio:'inherit'});
  const signals = ['SIGINT', 'SIGTERM'];
  const handlers = new Map(signals.map(signal => [signal, () => child.kill(signal)]));
  for (const [signal, handler] of handlers) process.on(signal, handler);
  const finish = () => { for (const [signal, handler] of handlers) process.off(signal, handler); };
  child.once('error', error => { finish(); console.error(error.message); process.exitCode = 1; });
  child.once('exit', (code, signal) => {
    finish();
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
