import {readKoreaInspectionDocument} from './korea-report-document';
import {isIP} from 'node:net';
import {DetailReadCache} from './detail-read-cache';
import {requestKoreaReportLinks, KoreaReportUnavailable} from './korea-report-source';
import type {KoreaReportLink, KoreaSourceReportKind} from './korea-report-types';

type Dependencies = Parameters<typeof requestKoreaReportLinks>[1] & {now?: () => number; documentFetcher?: typeof fetch};
/** Visitor-bound coalescing: never reuse another visitor's success to evade a refusal. */
export function createKoreaReportService(deps: Dependencies) {
 const now = deps.now || Date.now;
 const cache = new DetailReadCache<KoreaReportLink>({maxEntries:128,maxBytes:512*1024,ttlMs:5*60000,concurrency:2,maxQueued:8,queueTimeoutMs:1000,now});
 const failures = new Map<string,number>();
 return async (input: {offerId:string;lot:string;kind:KoreaSourceReportKind;ip:string}) => {
  const match = /^ajes-korea-([A-Za-z0-9_-]{1,64})$/.exec(input.offerId);
  if (!match || !/^\d{6,10}$/.test(input.lot) || !['history','inspection'].includes(input.kind) || !isIP(input.ip)) throw new KoreaReportUnavailable('input');
  await deps.assertEnabled();
  if ((failures.get(input.ip) || 0) > now()) throw new KoreaReportUnavailable('cooldown');
  const key = [input.ip,input.offerId,input.lot,input.kind].join('\0');
  return cache.get(key, async () => {
   if ((failures.get(input.ip) || 0) > now()) throw new KoreaReportUnavailable('cooldown');
   try {
    const links = await requestKoreaReportLinks({id:match[1],lot:input.lot,kind:input.kind,ip:input.ip}, deps);
    await deps.assertEnabled();
    const document=input.kind==='inspection'&&deps.documentFetcher?await readKoreaInspectionDocument(links.originalHref,input.lot,deps.documentFetcher):null;
    await deps.assertEnabled();
    return {...(deps.documentFetcher?{document}:{}),version:2,offerId:input.offerId,lot:input.lot,kind:input.kind,...links};
   } catch (error) {
    // A missing report must not prevent opening the other section. Refusals stop both.
    if (!(error instanceof KoreaReportUnavailable) || error.reason !== 'report_missing') {
     failures.set(input.ip,now()+(error instanceof KoreaReportUnavailable && error.reason==='refused'?300000:30000));
     while (failures.size > 256) failures.delete(failures.keys().next().value!);
    }
    throw error;
   }
  });
 };
}
