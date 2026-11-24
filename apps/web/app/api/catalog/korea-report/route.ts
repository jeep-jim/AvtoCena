import {NextResponse} from 'next/server';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const responseHeaders = {'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
export async function GET(_request: Request) {
 // This endpoint belonged to the retired AJ Korea source. Auto API records are independent.
 return NextResponse.json({error:'source_retired'},{status:410,headers:responseHeaders});
}
