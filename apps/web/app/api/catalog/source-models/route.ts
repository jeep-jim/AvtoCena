import {NextResponse} from 'next/server';
import {readAjesDirectory} from '@/lib/catalog/ajes-catalog';
import {AjesInputError} from '@/lib/catalog/ajes-query';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const p=new URL(request.url).searchParams,market=p.get('market');
 if(!['china','korea','japan'].includes(market||''))return NextResponse.json({error:'invalid_market'},{status:400});
 try{
  const result=await readAjesDirectory({market,make:p.get('make')||undefined});
  return NextResponse.json({version:1,brands:[],models:result.models.map(row=>[row.make,row.model,[],row.total]),stale:result.stale},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return NextResponse.json({error:'directory_unavailable'},{status:error instanceof AjesInputError?400:503});}
}
