import {NextResponse} from 'next/server';
import {readAjesDirectory} from '@/lib/catalog/ajes-catalog';
import {AjesUnavailable} from '@/lib/catalog/ajes-client';
import {AjesInputError} from '@/lib/catalog/ajes-query';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const p=new URL(request.url).searchParams,market=p.get('market');
 if(!['china','korea','japan'].includes(market||''))return NextResponse.json({error:'invalid_market'},{status:400});
 try{
  const result=await readAjesDirectory({market,make:p.get('make')||undefined});
  return NextResponse.json({version:1,brands:[],models:result.models.map(row=>[row.make,row.model,[],row.total]),stale:result.stale},{headers:{'Cache-Control':'no-store'}});
 }catch(error){
  const allowed=new Set(['visitor_restricted','client_ip_missing','not_configured','invalid_response','request_failed','request_timeout','connect_timeout','directory_too_large','directory_page_repeated']);
  const reason=error instanceof AjesUnavailable&&allowed.has(error.reason)?error.reason:error instanceof AjesInputError?'invalid_query':'operation_failed';
  console.warn('AJES_DIRECTORY_FAILURE',reason);
  return NextResponse.json({error:'directory_unavailable',reason},{status:error instanceof AjesInputError?400:503});
 }
}
