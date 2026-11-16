import fs from 'node:fs';

// Disposable diagnostic clone only. No Runtime.evaluate, heap, request URLs,
// environment values, or raw profile are emitted. Destroying the owned clone
// closes the inspector, including when its main JavaScript thread is blocked.
let sequence = 0;
const pending = new Map();
let ws;
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(Error('inspector_deadline')); }, 15000);
    pending.set(id, {resolve, reject, timer});
    ws.send(JSON.stringify({id, method, params}));
  });
}

try {
  const targets = await fetch('http://127.0.0.1:9229/json/list', {signal: AbortSignal.timeout(5000)}).then(r => r.json());
  if (!Array.isArray(targets) || targets.length !== 1) throw Error('inspector_target_scope');
  const url = new URL(targets[0].webSocketDebuggerUrl);
  if (url.hostname !== '127.0.0.1' || url.port !== '9229') throw Error('inspector_not_loopback');
  ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('inspector_connect_deadline')), 5000);
    ws.onopen = () => { clearTimeout(timer); resolve(); };
    ws.onerror = () => { clearTimeout(timer); reject(Error('inspector_connect_failed')); };
  });
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    clearTimeout(item.timer);
    message.error ? item.reject(Error('inspector_protocol_failed')) : item.resolve(message.result);
  };
  await call('Profiler.enable');
  await call('Profiler.setSamplingInterval', {interval: 2000});
  await call('Profiler.start');
  console.log(JSON.stringify({event: 'profile_ready', sampleSeconds: 100}));
  await new Promise(resolve => setTimeout(resolve, 100000));
  const {profile} = await call('Profiler.stop');
  const parents = new Map();
  const byId = new Map(profile.nodes.map(node => [node.id, node]));
  for (const node of profile.nodes) for (const child of node.children || []) parents.set(child, node.id);
  const counts = new Map();
  for (const id of profile.samples || []) counts.set(id, (counts.get(id) || 0) + 1);
  const sources = new Map();
  function describe(id) {
    const frame = byId.get(id)?.callFrame;
    if (!frame) return null;
    const source = String(frame.url || '');
    const appPath = source.startsWith('file:///app/apps/web/.next/server/') ? source.slice('file://'.length)
      : source.startsWith('/app/apps/web/.next/server/') ? source : '';
    const appSource = Boolean(appPath);
    const safeSource = appSource ? appPath.slice('/app/'.length) : source.startsWith('node:') ? source : '(runtime)';
    let code = '';
    if (appSource) {
      try {
        let lines = sources.get(source);
        if (!lines) {
          const file = appPath;
          if (fs.statSync(file).size <= 8 * 1024 * 1024) {
            lines = fs.readFileSync(file, 'utf8').split('\n');
            sources.set(source, lines);
          }
        }
        code = lines?.[frame.lineNumber]?.slice(Math.max(0, frame.columnNumber - 100), frame.columnNumber + 1100) || '';
      } catch { /* Function/line counters remain useful without bundled text. */ }
    }
    return {fn: String(frame.functionName || '(anonymous)').slice(0, 180), source: safeSource, line: frame.lineNumber + 1, column: frame.columnNumber + 1, ...(code ? {code} : {})};
  }
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([id, count]) => {
    const stack = [];
    for (let frameId = id; frameId !== undefined && stack.length < 5; frameId = parents.get(frameId)) {
      const frame = describe(frameId);
      if (frame) stack.push(frame);
    }
    return {count, stack};
  });
  // Print the CPU evidence immediately. Optional main-thread metrics must never
  // delay the evidence from a blocked request; this helper requests none.
  console.log(JSON.stringify({event: 'cpu_profile', seconds: (profile.endTime - profile.startTime) / 1e6, samples: profile.samples?.length || 0, top}));
  await call('Profiler.disable');
} catch (error) {
  const allowed = new Set(['inspector_deadline', 'inspector_target_scope', 'inspector_not_loopback', 'inspector_connect_deadline', 'inspector_connect_failed', 'inspector_protocol_failed']);
  console.log(JSON.stringify({event: 'profile_error', code: allowed.has(error?.message) ? error.message : 'profile_failed'}));
  process.exitCode = 1;
} finally {
  for (const item of pending.values()) clearTimeout(item.timer);
  pending.clear();
  ws?.close();
}
