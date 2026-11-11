import {NextResponse} from 'next/server';
import {headers} from 'next/headers';
import {ajesPassword} from '@/lib/catalog/ajes-settings';
import {ajesEndpoint} from '@/lib/catalog/ajes-routing';
import {assertCollectionEnabled} from '@/lib/catalog/collection-controls';
import {reserveAjesRequest} from '@/lib/catalog/ajes-quota';
import {getJsonStorage} from '@/lib/data';
import {createKoreaReportService} from '@/lib/catalog/korea-report-service';
import {KoreaReportUnavailable} from '@/lib/catalog/korea-report-source';
import type {KoreaSourceReportKind} from '@/lib/catalog/korea-report-types';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const readReport = createKoreaReportService({documentFetcher:fetch,password:ajesPassword,endpoint:ajesEndpoint,assertEnabled:()=>assertCollectionEnabled('ajes_korea_feed'),reserve:()=>reserveAjesRequest(getJsonStorage(),'korea')});
const responseHeaders = {'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
export async function GET(request: Request) {
 const p = new URL(request.url).searchParams;
 if ([...p.keys()].some(key=>!['id','lot','kind'].includes(key)) || ['id','lot','kind'].some(key=>p.getAll(key).length!==1)) return NextResponse.json({error:'invalid_request'},{status:400,headers:responseHeaders});
 try {
  const report = await readReport({offerId:p.get('id')||'',lot:p.get('lot')||'',kind:p.get('kind') as KoreaSourceReportKind,ip:(await headers()).get('x-real-ip')||''});
  return NextResponse.json(report,{headers:responseHeaders});
 } catch (error) {
  const reason = error instanceof KoreaReportUnavailable ? error.reason : 'unavailable';
  const status = reason==='input'?400:reason==='report_missing'?404:reason==='cooldown'||reason==='refused'?429:503;
  return NextResponse.json({error:status===404?'report_missing':'report_unavailable'},{status,headers:{...responseHeaders,...(status===429?{'Retry-After':'300'}:{})}});
 }
}
