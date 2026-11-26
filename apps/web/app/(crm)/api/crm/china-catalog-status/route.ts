import {NextResponse} from 'next/server';
import {getCurrentUser} from '@/lib/auth';
import {isPlatformOwner} from '@/lib/platform-access';
import {readChinaCatalogStatus, type ChinaCatalogStatus} from '@/lib/catalog/china-catalog-status';

export const dynamic = 'force-dynamic';
const reply = (value: ChinaCatalogStatus, status = 200) =>
  NextResponse.json(value, {status, headers: {'Cache-Control': 'private, no-store'}});

export async function GET() {
  if (!isPlatformOwner(await getCurrentUser())) return reply({status: 'unavailable'}, 403);
  return reply(await readChinaCatalogStatus());
}
