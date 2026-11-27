import {createHash} from 'node:crypto';
import {publicAjesReadReceipt, type AjesReadReceipt} from './ajes-read-receipt';

export const AJES_SSR_READ_EVIDENCE_ATTRIBUTE = 'data-japan-source-receipts';
export const AJES_SSR_READ_EVIDENCE_LIMIT = 8;
export const AJES_SSR_READ_EVIDENCE_BYTES = 8192;
const required = ['version','requestId','queryHash','table','kind','page','pageSize','startedAt','finishedAt',
  'stage','supplierAttempted','outcome'] as const;
const optional = ['reason','observedAt'] as const;
const allowed = new Set<string>([...required,...optional]);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const date = (value:unknown) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value));

/** Project only the existing public receipt. Unknown fields and accessors are
 * not inspected or serialized, even when an upstream exception contains them.
 */
function finiteReceipt(value:unknown):AjesReadReceipt|undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const fields = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(fields);
  if (keys.some(key => typeof key !== 'string' || !allowed.has(key) || !Object.hasOwn(fields[key], 'value'))
    || required.some(key => !Object.hasOwn(fields[key] ?? {}, 'value'))) return undefined;
  const plain = Object.fromEntries(keys.map(key => [key,fields[key as string].value]));
  if (!uuid.test(typeof plain.requestId === 'string' ? plain.requestId : '') || typeof plain.queryHash !== 'string'
    || !date(plain.startedAt) || !date(plain.finishedAt) || Date.parse(plain.startedAt) > Date.parse(plain.finishedAt)
    || Object.hasOwn(plain,'reason') && (typeof plain.reason !== 'string' || plain.reason.length > 64)
    || Object.hasOwn(plain,'observedAt') && !date(plain.observedAt)) return undefined;
  const result = publicAjesReadReceipt(plain);
  if (!result || Object.hasOwn(plain,'reason') && result.reason !== plain.reason) return undefined;
  return result;
}

/** An inert SSR annotation, bound to the visible page and the exact issued
 * continuation. This does not read, persist or refresh any source/cache data.
 * It never accepts the whole result or exception as its payload.
 */
export function ajesSsrReadEvidence(page:unknown, after:unknown, sourceReceipts:unknown):string|undefined {
  try {
    const currentPage = typeof page === 'string' && /^[1-9]\d{0,6}$/.test(page) ? Number(page) : page;
    if (!Number.isSafeInteger(currentPage) || (currentPage as number) < 1 || (currentPage as number) > 1_000_000
      || after !== undefined && (typeof after !== 'string' || after.length > 512)) return undefined;
    const source = sourceReceipts === undefined ? [] : sourceReceipts;
    if (!Array.isArray(source) || source.length > 1_000_000) return undefined;
    const positions = source.length <= AJES_SSR_READ_EVIDENCE_LIMIT ? Array.from({length:source.length},(_,i)=>i)
      : [0,1,2,3,source.length-4,source.length-3,source.length-2,source.length-1];
    const receipts:AjesReadReceipt[] = [], seen = new Set<string>();
    for (const position of positions) {
      const descriptor = Object.getOwnPropertyDescriptor(source, String(position));
      if (!descriptor || !Object.hasOwn(descriptor,'value')) continue;
      const receipt = finiteReceipt(descriptor.value);
      if (!receipt || seen.has(receipt.requestId)) continue;
      seen.add(receipt.requestId); receipts.push(receipt);
    }
    const output = JSON.stringify({version:1,page:currentPage,
      afterSha256:createHash('sha256').update(after === undefined ? '' : after as string).digest('hex'),
      receipts,omitted:source.length-receipts.length});
    return Buffer.byteLength(output) <= AJES_SSR_READ_EVIDENCE_BYTES ? output : undefined;
  } catch { return undefined; }
}
