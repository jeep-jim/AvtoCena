import {NextResponse} from 'next/server';
export const dynamic='force-dynamic';
// Retired sources are outside the approved production allowlist.
export async function GET(){return NextResponse.json({error:'catalog_source_not_approved'},{status: 410,headers:{'Cache-Control':'no-store'}});}
export const POST=GET;
