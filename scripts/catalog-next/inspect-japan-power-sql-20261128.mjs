// One fixed saved failure object. SQL is never executed, printed or persisted.
// The only transport is one bounded S3 GET; there are no application imports.
import {createHash, createHmac} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {verifyReadonlyInvocation} from '../lib/readonly-marker-invocation.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const MARKER = '.github/market-runs/japan-power-sql-20261128-readonly.json';
export const OPERATION = 'inspect-japan-power-sql-20261128';
export const WORKFLOW = 'jeep-jim/AvtoCena/.github/workflows/japan-power-sql-20261128-readonly.yml@refs/heads/main';
export const PROFILE = Object.freeze({runtimeSha: 'deee0fefa0c50bab3397acb5232eca4eed47bbe1',
  key: 'integrations/ajes/catalog-failure-pages/stats-list-1.json',
  sqlSha256: '1880ccb86d834592edaf932d2f31fcd361fdf1ede96b397e18d33b33216310da', sqlBytes: 3982,
  table: 'stats', kind: 'list', page: 1, pageSize: 24, httpStatus: 500, outcome: 'http_500'});
export const LIMIT = Object.freeze({objects: 1, objectBytes: 64 * 1024, sqlBytes: 16 * 1024,
  tokens: 8192, depth: 256, regexps: 128, regexpShapeBytes: 256,
  requestMs: 7000, totalMs: 10_000, outputBytes: 32 * 1024});
const ENDPOINT = 'https://s3.regru.cloud', BUCKET = 'avtocena-staging-8120751';
const PREFIX = 'migration-staging/full-20261011/', REGION = 'us-east-1';
const hash = value => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
class AuditError extends Error { constructor(code) { super(code); this.code = code; } }
const need = (value, code) => { if (!value) throw new AuditError(code); };
const own = (value, key) => {
  need(object(value), 'record_invalid');
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  need(!descriptor || Object.hasOwn(descriptor, 'value'), 'record_invalid');
  return descriptor?.value;
};
const isoTime = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

// Only these fixed vocabulary entries can be copied into the SQL template.
// Arbitrary identifiers, strings, numbers, comments and variables are masked.
const KEYWORDS = new Set('select from where and or not in is null between like regexp rlike order by asc desc limit offset as case when then else end distinct group having binary collate using exists union all true false'.split(' '));
const COLUMNS = new Set('stats main id year marka_name model_name kuzov grade drive pw eng_v time transmission priv finish start data date body_type color rate mileage status model_gross'.split(' '));
const FUNCTIONS = new Set('upper lower replace trim ltrim rtrim coalesce ifnull nullif concat concat_ws char cast convert length char_length octet_length abs greatest least round floor ceil ceiling regexp_like regexp_replace regexp_substr substring substring_index substr left right count sum min max avg date_format unix_timestamp to_days'.split(' '));
const OPERATORS = new Set('= != <> < > <= >= + - * / % & | ^ ~ ! || && << >> :='.split(' '));
export const SAFE_REGEXPS = Object.freeze([
  '^[[:space:]]*[0-9]{1,30}[[:space:]]*$', '[^ -~]', '^[0-9]+$', '^[0-9]{1,30}$',
  '^[A-Za-z0-9_-]{1,64}$', '^[0-9]+([.][0-9]+)?$',
]);

function tokenize(sql) {
  need(typeof sql === 'string' && Buffer.byteLength(sql) > 0 && Buffer.byteLength(sql) <= LIMIT.sqlBytes, 'sql_bounds');
  const tokens = []; let position = 0, comments = 0, depth = 0, maximumDepth = 0, balanced = true;
  const add = token => { need(tokens.length < LIMIT.tokens, 'token_limit'); tokens.push(token); };
  while (position < sql.length) {
    const c = sql[position];
    if (/\s/u.test(c)) { position++; continue; }
    if (sql.startsWith('/*', position)) {
      const end = sql.indexOf('*/', position + 2); need(end >= 0, 'unclosed_comment');
      need(sql[position + 2] !== '!', 'executable_comment');
      comments++; add({kind: 'comment'}); position = end + 2; continue;
    }
    if (c === '#' || sql.startsWith('--', position) && /\s|^$/.test(sql[position + 2] || '')) {
      const end = sql.indexOf('\n', position); comments++; add({kind: 'comment'});
      position = end < 0 ? sql.length : end + 1; continue;
    }
    if (["'", '"', '`'].includes(c)) {
      const quote = c, start = position; let value = '', closed = false, backslashEscapes = 0, doubledQuotes = 0; position++;
      while (position < sql.length) {
        const next = sql[position++];
        if (next === quote) {
          if (sql[position] === quote) { value += quote; position++; doubledQuotes++; continue; }
          closed = true; break;
        }
        if (next === '\\' && quote !== '`') {
          need(position < sql.length, 'unclosed_quote'); value += sql[position++]; backslashEscapes++;
        } else value += next;
      }
      need(closed, 'unclosed_quote');
      add({kind: quote === '`' ? 'word' : 'string', value: quote === '`' ? value.toLowerCase() : value,
        spelling: sql.slice(start, position), quotedIdentifier: quote === '`', doubleQuoted: quote === '"', backslashEscapes, doubledQuotes}); continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(sql.slice(position));
    if (word) { add({kind: 'word', value: word[0].toLowerCase()}); position += word[0].length; continue; }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(sql.slice(position));
    if (number) { add({kind: 'number', value: number[0]}); position += number[0].length; continue; }
    const pair = sql.slice(position, position + 2);
    if (OPERATORS.has(pair)) { add({kind: 'operator', value: pair}); position += 2; continue; }
    if (OPERATORS.has(c)) { add({kind: 'operator', value: c}); position++; continue; }
    if ('(),.;?'.includes(c)) {
      if (c === '(') { depth++; maximumDepth = Math.max(maximumDepth, depth); need(depth <= LIMIT.depth, 'depth_limit'); }
      if (c === ')') { depth--; if (depth < 0) balanced = false; }
      add({kind: 'punctuation', value: c}); position++; continue;
    }
    add({kind: 'other'}); position++;
  }
  return {tokens, comments, maximumDepth, balancedParentheses: balanced && depth === 0};
}

// Family names and IDs inside a regexp never become output. Only the exact
// public patterns above retain their literal text; other patterns retain a
// bounded metacharacter shape in which every text/number run becomes <text>.
function regexpSummary(value, exactLiteral) {
  const approved = exactLiteral ? SAFE_REGEXPS.find(pattern => pattern === value) : undefined;
  const base = {decodedUtf8Bytes: Buffer.byteLength(value), pipeCharacters: (value.match(/\|/g) || []).length,
    containsNonAscii: /[^\x00-\x7f]/.test(value)};
  if (approved !== undefined) return {...base, policy: 'fixed_allowlist', literal: approved};
  let shape = '', text = false;
  for (const c of value) {
    if ('^$()[]{}|*+?.-/ ,:'.includes(c)) { shape += c; text = false; }
    else if (!text) { shape += '<text>'; text = true; }
  }
  return {...base, policy: 'metacharacters_only', shape: shape.slice(0, LIMIT.regexpShapeBytes),
    shapeTruncated: shape.length > LIMIT.regexpShapeBytes};
}

function literalCounts(tokens, column) {
  const values = [], counts = {comparisonPredicates: 0, inPredicates: 0, regexpPredicates: 0, literalOccurrences: 0, distinctLiteralSpellings: 0};
  const literal = token => token && ['string', 'number'].includes(token.kind);
  const spelling = token => token.kind + ':' + (token.spelling ?? token.value);
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind !== 'word' || tokens[i].value !== column) continue;
    let next = i + 1;
    if (tokens[next]?.value === 'not') next++;
    const operator = tokens[next]?.value;
    if (['regexp', 'rlike'].includes(operator)) { counts.regexpPredicates++; continue; }
    if (['=', '!=', '<>', '<', '>', '<=', '>=', 'like'].includes(operator) && literal(tokens[next + 1])) {
      counts.comparisonPredicates++; values.push(spelling(tokens[next + 1]));
    } else if (operator === 'in' && tokens[next + 1]?.value === '(') {
      counts.inPredicates++; let nesting = 1;
      for (let j = next + 2; j < tokens.length && nesting; j++) {
        if (tokens[j].value === '(') nesting++;
        else if (tokens[j].value === ')') nesting--;
        else if (nesting === 1 && literal(tokens[j])) values.push(spelling(tokens[j]));
      }
    } else if (operator === 'between' && literal(tokens[next + 1]) && tokens[next + 2]?.value === 'and' && literal(tokens[next + 3])) {
      counts.comparisonPredicates++; values.push(spelling(tokens[next + 1]), spelling(tokens[next + 3]));
    }
  }
  counts.literalOccurrences = values.length; counts.distinctLiteralSpellings = new Set(values).size;
  return counts;
}

/** Pure, nonexecuting lexical projection. Literal counts are SQL spellings,
 * not vehicle counts, model coverage or a database syntax validation. */
export function summarizeSqlStructure(sql) {
  const {tokens, ...lexical} = tokenize(sql), keywords = {}, columns = {}, functions = {}, operators = {}, regexps = [];
  const increment = (target, name) => { target[name] = (target[name] || 0) + 1; };
  let unknownIdentifiers = 0, unknownCharacters = 0, strings = 0, numbers = 0, doubleQuoted = 0;
  const template = tokens.map((token, index) => {
    if (token.kind === 'word') {
      if (FUNCTIONS.has(token.value) && tokens[index + 1]?.value === '(') increment(functions, token.value);
      if (KEYWORDS.has(token.value)) increment(keywords, token.value);
      if (COLUMNS.has(token.value)) increment(columns, token.value);
      if (KEYWORDS.has(token.value) || COLUMNS.has(token.value) || FUNCTIONS.has(token.value)) return token.value;
      unknownIdentifiers++; return '<identifier>';
    }
    if (token.kind === 'string') {
      strings++; if (token.doubleQuoted) doubleQuoted++;
      if (['regexp', 'rlike'].includes(tokens[index - 1]?.value)) {
        need(regexps.length < LIMIT.regexps, 'regexp_limit');
        const field = tokens[index - 2]?.value;
        regexps.push({column: COLUMNS.has(field) ? field : null, backslashEscapes: token.backslashEscapes,
          doubledQuotes: token.doubledQuotes, ...regexpSummary(token.value, token.backslashEscapes === 0 && token.doubledQuotes === 0)});
        return '<regexp>';
      }
      return '<string>';
    }
    if (token.kind === 'number') { numbers++; return '<number>'; }
    if (token.kind === 'operator') { increment(operators, token.value); return token.value; }
    if (token.kind === 'punctuation') return token.value;
    if (token.kind === 'comment') return '<comment>';
    unknownCharacters++; return '<character>';
  }).join(' ');
  const fakeQuery = new URLSearchParams({ip: '192.0.2.1', json: '', code: 'fake-code', sql}).toString();
  const report = {template, lexical: {...lexical, tokens: tokens.length, unknownIdentifiers, unknownCharacters,
    doubleQuotedTokens: doubleQuoted, semicolons: tokens.filter(token => token.value === ';').length,
    serverSyntaxValidated: false, serverSqlModeKnown: false}, keywords, columns, functions, operators, regexps,
    literals: {strings, numbers}, comparisonLiteralCounts: {
      models: literalCounts(tokens, 'model_name'), makes: literalCounts(tokens, 'marka_name'),
      years: literalCounts(tokens, 'year'), ids: literalCounts(tokens, 'id')},
    encoding: {sqlUtf8Bytes: Buffer.byteLength(sql), sqlFormEncodedBytes: new URLSearchParams({sql}).toString().length - 4,
      queryWithSyntheticCredentialsBytes: Buffer.byteLength(fakeQuery),
      urlWithSyntheticEndpointAndCredentialsBytes: Buffer.byteLength('https://diagnostic.invalid/api/?' + fakeQuery),
      actualCredentialAndEndpointLengthsUsed: false}};
  need(Buffer.byteLength(JSON.stringify(report)) <= LIMIT.outputBytes - 2048, 'output_limit');
  return report;
}

/** Pure binding/projection, separately testable with synthetic records. The
 * network entry point below always passes the immutable PROFILE. */
export function summarizeBoundSavedFailure(saved, binding = PROFILE) {
  need(object(binding) && /^[a-f0-9]{64}$/.test(own(binding, 'sqlSha256') || '')
    && Number.isSafeInteger(own(binding, 'sqlBytes')) && binding.sqlBytes > 0 && binding.sqlBytes <= LIMIT.sqlBytes
    && ['table', 'kind', 'page', 'pageSize', 'httpStatus', 'outcome'].every(key => own(binding, key) === PROFILE[key]), 'binding_invalid');
  const sql = own(saved, 'sql');
  need(typeof sql === 'string' && Buffer.byteLength(sql) <= LIMIT.sqlBytes, 'record_invalid');
  const sqlSha256 = hash(sql), sqlBytes = Buffer.byteLength(sql);
  if (sqlSha256 !== binding.sqlSha256 || sqlBytes !== binding.sqlBytes)
    return {readStatus: 'sql_binding_mismatch', sqlSha256, sqlBytes};
  for (const key of ['table', 'kind', 'page', 'pageSize', 'httpStatus', 'outcome']) need(own(saved, key) === binding[key], 'record_binding');
  const startedAt = own(saved, 'startedAt'), finishedAt = own(saved, 'finishedAt');
  need(isoTime(startedAt) && isoTime(finishedAt) && Date.parse(finishedAt) >= Date.parse(startedAt), 'record_binding');
  return {readStatus: 'matched', sqlSha256, sqlBytes, startedAt, finishedAt,
    durationMs: Date.parse(finishedAt) - Date.parse(startedAt), httpStatus: binding.httpStatus,
    structure: summarizeSqlStructure(sql)};
}

export function verifyJapanPowerSqlInvocation({root = ROOT, environment = process.env} = {}) {
  need(environment.GITHUB_ACTIONS === 'true' && environment.GITHUB_EVENT_NAME === 'push'
    && environment.GITHUB_WORKFLOW_REF === WORKFLOW && environment.GITHUB_JOB === 'inspect', 'invocation');
  return verifyReadonlyInvocation({root, env: environment, markerPath: MARKER, operation: OPERATION});
}

export async function inspectJapanPowerSql(options = {}) {
  need(object(options) && Object.keys(options).every(key => ['env', 'fetcher', 'now'].includes(key)), 'options');
  const {env = process.env, fetcher = globalThis.fetch, now = Date.now} = options;
  need(typeof fetcher === 'function' && typeof now === 'function', 'capabilities');
  const report = {version: 1, kind: 'japan-saved-power-sql-structure-v1', runtimeSha: PROFILE.runtimeSha,
    expectedSqlSha256: PROFILE.sqlSha256, expectedSqlBytes: PROFILE.sqlBytes,
    attribution: 'exact_saved_sql_hash_not_run_identity', completed: false,
    objectGets: 0, acceptedResponseBytes: 0, historyReads: 0, bucketListings: 0,
    supplierRequests: 0, hostRequests: 0, storageWrites: 0};
  const started = now(); need(Number.isFinite(started), 'clock');
  const deadline = started + LIMIT.totalMs, controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(LIMIT.requestMs, LIMIT.totalMs));
  let response, reader, onAbort;
  const interrupted = new Promise((_, reject) => {
    onAbort = () => reject(new AuditError('deadline')); controller.signal.addEventListener('abort', onAbort, {once: true});
  });
  interrupted.catch(() => {});
  const live = () => need(!controller.signal.aborted && now() < deadline, 'deadline');
  try {
    need(typeof env.REGCLOUD_S3_ACCESS_KEY_ID === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(env.REGCLOUD_S3_ACCESS_KEY_ID)
      && typeof env.REGCLOUD_S3_SECRET_ACCESS_KEY === 'string' && env.REGCLOUD_S3_SECRET_ACCESS_KEY.length >= 16
      && env.REGCLOUD_S3_SECRET_ACCESS_KEY.length <= 256, 'configuration_unavailable');
    const url = new URL(`${ENDPOINT}/${BUCKET}/${(PREFIX + PROFILE.key).split('/').map(encode).join('/')}`);
    const stamp = new Date(now()).toISOString().replace(/[:-]|\.\d{3}/g, ''), day = stamp.slice(0, 8);
    const scope = `${day}/${REGION}/s3/aws4_request`, payload = hash('');
    const headers = {host: url.host, 'x-amz-content-sha256': payload, 'x-amz-date': stamp};
    const names = Object.keys(headers).sort(), canonicalHeaders = names.map(name => `${name}:${headers[name]}\n`).join('');
    const canonical = ['GET', url.pathname, '', canonicalHeaders, names.join(';'), payload].join('\n');
    const signing = hmac(hmac(hmac(hmac('AWS4' + env.REGCLOUD_S3_SECRET_ACCESS_KEY, day), REGION), 's3'), 'aws4_request');
    const signature = createHmac('sha256', signing).update(['AWS4-HMAC-SHA256', stamp, scope, hash(canonical)].join('\n')).digest('hex');
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${env.REGCLOUD_S3_ACCESS_KEY_ID}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
    headers['accept-encoding'] = 'identity';
    live(); report.objectGets++;
    response = await Promise.race([Promise.resolve(fetcher(url, {method: 'GET', headers, redirect: 'error', signal: controller.signal}))
      .then(value => { if (controller.signal.aborted) { void value.body?.cancel().catch(() => {}); throw new AuditError('deadline'); } return value; }), interrupted]);
    live();
    if (response.status === 404) report.readStatus = 'missing';
    else {
      need(response.status === 200, 'unavailable');
      need(!response.headers.get('content-encoding') || response.headers.get('content-encoding') === 'identity', 'encoding');
      const declared = response.headers.get('content-length');
      need(declared === null || /^\d{1,9}$/.test(declared) && Number(declared) <= LIMIT.objectBytes, 'byte_limit');
      reader = response.body?.getReader(); need(reader, 'body_missing');
      const chunks = [];
      while (true) {
        live(); const item = await Promise.race([reader.read(), interrupted]); live();
        if (item.done) break;
        need(item.value instanceof Uint8Array && report.acceptedResponseBytes + item.value.byteLength <= LIMIT.objectBytes, 'byte_limit');
        report.acceptedResponseBytes += item.value.byteLength; chunks.push(item.value);
      }
      need(declared === null || report.acceptedResponseBytes === Number(declared), 'body_size');
      let saved;
      try { saved = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks, report.acceptedResponseBytes))); }
      catch { throw new AuditError('body_invalid'); }
      Object.assign(report, summarizeBoundSavedFailure(saved, PROFILE));
      report.completed = report.readStatus === 'matched';
    }
  } catch (error) { report.readStatus = error instanceof AuditError ? error.code : 'unavailable'; }
  finally {
    clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort); controller.abort();
    if (reader) void reader.cancel().catch(() => {}); else if (response?.body) void response.body.cancel().catch(() => {});
  }
  need(Buffer.byteLength(JSON.stringify(report)) <= LIMIT.outputBytes, 'output_limit');
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    need(process.argv.length === 3 && ['--verify', '--run'].includes(process.argv[2]), 'arguments');
    const invocation = verifyJapanPowerSqlInvocation();
    if (process.argv[2] === '--verify') process.stdout.write(JSON.stringify({verified: true, invocation}) + '\n');
    else {
      const report = {...await inspectJapanPowerSql(), invocation};
      need(Buffer.byteLength(JSON.stringify(report)) <= LIMIT.outputBytes, 'output_limit');
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      if (!report.completed) process.exitCode = 1;
    }
  } catch {
    process.stdout.write(JSON.stringify({version: 1, kind: 'japan-saved-power-sql-structure-v1', completed: false,
      errorCode: 'invocation_or_audit_failed', supplierRequests: 0, hostRequests: 0, storageWrites: 0}) + '\n');
    process.exitCode = 1;
  }
}
