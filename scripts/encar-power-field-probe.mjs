import fs from 'node:fs/promises';

const HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  origin: 'https://fem.encar.com',
  referer: 'https://fem.encar.com/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36',
};

const DEFAULT_IDS = [
  '42316687', // Kia Morning Urban 998cc combustion
  '42196711', // BMW 320i combustion
  '42305406', // Hyundai Tucson 1.6T combustion
  '42057808', // Hyundai Santa Fe HEV
  '42058013', // Kia K8 HEV
  '42477566', // Kia EV6
  '42120279', // Audi e-tron
];

const ids = String(process.env.ENCAR_PROBE_IDS || DEFAULT_IDS.join(','))
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .slice(0, 20);

const KEY_RE = /(?:power|horse|hp|ps|kw|output|performance|engine|motor|displacement|fuel|drive|torque|spec|cc)/i;
const VALUE_RE = /(?:마력|출력|토크|배기량|엔진|모터|kW|\bPS\b|\bhp\b|horsepower)/i;

function scalar(value) {
  return value == null || ['string', 'number', 'boolean'].includes(typeof value);
}

function compact(value) {
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  return value;
}

function collectInteresting(value, path = '', depth = 0, out = []) {
  if (value == null || depth > 12 || out.length >= 300) return out;
  if (Array.isArray(value)) {
    for (let i = 0; i < Math.min(value.length, 30); i++) collectInteresting(value[i], `${path}[${i}]`, depth + 1, out);
    return out;
  }
  if (typeof value !== 'object') return out;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (scalar(child)) {
      const rendered = child == null ? '' : String(child);
      if (KEY_RE.test(key) || KEY_RE.test(childPath) || VALUE_RE.test(rendered)) {
        out.push({ path: childPath, key, value: compact(child) });
        if (out.length >= 300) return out;
      }
    } else {
      collectInteresting(child, childPath, depth + 1, out);
      if (out.length >= 300) return out;
    }
  }
  return out;
}

function collectKeyPaths(value, path = '', depth = 0, out = new Set()) {
  if (value == null || depth > 8 || out.size >= 1200 || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const child of value.slice(0, 5)) collectKeyPaths(child, `${path}[]`, depth + 1, out);
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    out.add(childPath);
    if (child && typeof child === 'object') collectKeyPaths(child, childPath, depth + 1, out);
    if (out.size >= 1200) break;
  }
  return out;
}

async function fetchDetail(id) {
  const response = await fetch(`https://api.encar.com/v1/readside/vehicle/${encodeURIComponent(id)}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) return { id, status: response.status, contentType: response.headers.get('content-type') || '', error: text.slice(0, 1000) };
  let data;
  try { data = JSON.parse(text); }
  catch { return { id, status: response.status, contentType: response.headers.get('content-type') || '', error: 'invalid_json', body: text.slice(0, 1000) }; }
  const root = data?.vehicle || data?.Vehicle || data;
  const allPaths = [...collectKeyPaths(root)].sort();
  return {
    id,
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    topLevelKeys: Object.keys(root || {}).sort(),
    interesting: collectInteresting(root),
    powerLikePaths: allPaths.filter((entry) => KEY_RE.test(entry)).slice(0, 400),
    allPathCount: allPaths.length,
  };
}

const result = {
  generatedAt: new Date().toISOString(),
  mode: 'encar_exact_detail_power_field_probe_no_publish',
  endpoint: 'https://api.encar.com/v1/readside/vehicle/{sourceOfferId}',
  ids,
  rows: [],
};

for (const id of ids) {
  try { result.rows.push(await fetchDetail(id)); }
  catch (error) { result.rows.push({ id, error: String(error?.message || error) }); }
}

await fs.writeFile('encar-power-field-probe.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
