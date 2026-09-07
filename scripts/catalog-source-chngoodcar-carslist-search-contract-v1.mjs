import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { extractGoodCarScriptSources } from './catalog-source-chngoodcar-carslist-route-probe-v1.mjs';

const BASE_URL = 'https://www.chngoodcar.com';
const LIST_URL = `${BASE_URL}/Home/CarsList`;
const OUTPUT_PATH = process.env.CATALOG_SOURCE_CHNGOODCAR_SEARCH_CONTRACT_OUTPUT || 'catalog-source-chngoodcar-carslist-search-contract-v1.json';
const TIMEOUT_MS = Math.max(3000, Math.min(45000, Number(process.env.CATALOG_SOURCE_CHNGOODCAR_SEARCH_CONTRACT_TIMEOUT_MS || 15000)));
const USER_AGENT = 'AvtoCenaGoodCarCarsListSearchContract/1.0 (+read-only source-declared contract)';
const HEADERS = {
  accept: 'text/html,application/javascript,text/javascript;q=0.9,text/plain;q=0.8,*/*;q=0.5',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.6',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'user-agent': USER_AGENT,
};

function clean(value, limit = 2000) {
  return String(value ?? '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

async function fetchText(url, referer) {
  const response = await fetch(url, {
    headers: { ...HEADERS, ...(referer ? { referer } : {}) },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`http_${response.status}:${url}`);
  return { response, body };
}

export function splitJsArgs(raw) {
  const out = [];
  let current = '';
  let quote = null;
  let escaped = false;
  let depth = 0;
  for (let i = 0; i < String(raw || '').length; i += 1) {
    const ch = raw[i];
    if (quote) {
      current += ch;
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; current += ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') { depth += 1; current += ch; continue; }
    if (ch === ')' || ch === ']' || ch === '}') { depth = Math.max(0, depth - 1); current += ch; continue; }
    if (ch === ',' && depth === 0) { out.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  if (current.trim() || raw === '') out.push(current.trim());
  return out;
}

function decodeQuoted(token) {
  const text = String(token || '').trim();
  const q = text[0];
  if (!(q === '"' || q === "'" || q === '`') || text.at(-1) !== q) return undefined;
  const inner = text.slice(1, -1);
  return inner.replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');
}

export function parseJsLiteral(token) {
  const text = String(token || '').trim();
  const quoted = decodeQuoted(text);
  if (quoted !== undefined) return { exact: true, type: 'string', value: quoted };
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return { exact: true, type: 'number', value: Number(text) };
  if (text === 'true' || text === 'false') return { exact: true, type: 'boolean', value: text === 'true' };
  if (text === 'null') return { exact: true, type: 'null', value: null };
  return { exact: false, expression: clean(text, 240) };
}

function balancedCall(code, openParenIndex) {
  let quote = null;
  let escaped = false;
  let depth = 0;
  for (let i = openParenIndex; i < code.length; i += 1) {
    const ch = code[i];
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '(') { depth += 1; continue; }
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) return { argsRaw: code.slice(openParenIndex + 1, i), end: i };
    }
  }
  return null;
}

export function extractPagerContract(code) {
  const text = String(code || '');
  const signatureMatch = text.match(/function\s+pager\s*\(([^)]*)\)/i);
  const signature = signatureMatch ? splitJsArgs(signatureMatch[1]).map((x) => x.trim()).filter(Boolean) : [];
  const functionIndex = signatureMatch?.index ?? -1;
  const functionOpen = signatureMatch ? text.indexOf('(', functionIndex) : -1;
  const functionCall = functionOpen >= 0 ? balancedCall(text, functionOpen) : null;
  const functionBodyStart = functionCall ? text.indexOf('{', functionCall.end) : -1;
  let functionBodyEnd = -1;
  if (functionBodyStart >= 0) {
    let depth = 0;
    let quote = null;
    let escaped = false;
    for (let i = functionBodyStart; i < text.length; i += 1) {
      const ch = text[i];
      if (quote) {
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) { functionBodyEnd = i; break; }
      }
    }
  }
  const functionBody = functionBodyStart >= 0 && functionBodyEnd > functionBodyStart ? text.slice(functionBodyStart, functionBodyEnd + 1) : '';
  const endpointRaw = functionBody.match(/\bvar\s+url\s*=\s*["']([^"']+)["']/i)?.[1] || null;
  const method = functionBody.match(/\btype\s*:\s*["'](GET|POST)["']/i)?.[1]?.toUpperCase() || null;
  const pagesize = Number(functionBody.match(/\bvar\s+pagesize\s*=\s*(\d+)/i)?.[1] || 0) || null;
  const endpoint = endpointRaw ? new URL(endpointRaw, LIST_URL).toString() : null;

  const calls = [];
  const re = /\bpager\s*\(/gi;
  for (const match of text.matchAll(re)) {
    const index = match.index ?? 0;
    if (functionIndex >= 0 && index >= functionIndex && functionBodyEnd > 0 && index <= functionBodyEnd) continue;
    const open = text.indexOf('(', index);
    const parsed = balancedCall(text, open);
    if (!parsed) continue;
    const args = splitJsArgs(parsed.argsRaw);
    const literals = args.map(parseJsLiteral);
    calls.push({
      index,
      argCount: args.length,
      args: literals,
      allLiteral: literals.every((x) => x.exact),
      snippet: clean(text.slice(Math.max(0, index - 220), Math.min(text.length, parsed.end + 260)), 1200),
    });
  }

  return { signature, endpointRaw, endpoint, method, pagesize, calls };
}

function verificationTokenContract(html) {
  const tags = [...String(html || '').matchAll(/<input\b[^>]*>/gi)].map((m) => m[0]);
  const tag = tags.find((x) => /\bname\s*=\s*["']__RequestVerificationToken["']/i.test(x));
  if (!tag) return { present: false, fieldName: '__RequestVerificationToken', valuePresent: false };
  const value = tag.match(/\bvalue\s*=\s*["']([^"']+)["']/i)?.[1] || '';
  return { present: true, fieldName: '__RequestVerificationToken', valuePresent: Boolean(value), valueLength: value.length || null };
}

export async function runGoodCarCarsListSearchContract() {
  const list = await fetchText(LIST_URL, BASE_URL);
  const scripts = extractGoodCarScriptSources(list.body, LIST_URL);
  const carListScriptUrl = scripts.find((url) => /\/web_en\/js\/cn\/car_list\.js(?:[?#]|$)/i.test(url));
  if (!carListScriptUrl) throw new Error('source_declared_car_list_js_missing');
  const js = await fetchText(carListScriptUrl, LIST_URL);
  const contract = extractPagerContract(js.body);
  const literalCalls = contract.calls.filter((call) => call.allLiteral && call.argCount === contract.signature.length);

  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: 'chngoodcar_carslist_search_contract_no_write',
    productionWrites: false,
    classificationMutations: false,
    publishAllowedMutations: false,
    objectStorageWrites: false,
    catalogGenerationWrites: false,
    rawBodiesStored: false,
    guessedRoutes: false,
    listUrl: LIST_URL,
    listStatus: list.response.status,
    listBodyHashSha256: crypto.createHash('sha256').update(list.body).digest('hex'),
    verificationToken: verificationTokenContract(list.body),
    sourceDeclaredCarListScriptUrl: carListScriptUrl,
    scriptStatus: js.response.status,
    scriptBodyHashSha256: crypto.createHash('sha256').update(js.body).digest('hex'),
    contract,
    literalPagerCalls: literalCalls,
    next: literalCalls.length === 1
      ? 'A unique literal initial pager call is proven; reproduce that exact POST contract in a separate read-only page probe.'
      : 'Resolve the initial pager arguments only from source-declared DOM/code evidence before any POST page probe.',
  };
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({
    output: OUTPUT_PATH,
    endpoint: contract.endpoint,
    method: contract.method,
    pagesize: contract.pagesize,
    signature: contract.signature,
    callCount: contract.calls.length,
    literalCallCount: literalCalls.length,
    verificationToken: payload.verificationToken,
    pagerCalls: contract.calls,
  }, null, 2));
  return payload;
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entryUrl === import.meta.url) {
  runGoodCarCarsListSearchContract().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
