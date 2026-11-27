import {NextResponse} from 'next/server';
import {readAjesDirectory} from '@/lib/catalog/ajes-catalog';
import {AjesUnavailable} from '@/lib/catalog/ajes-client';
import {AjesInputError} from '@/lib/catalog/ajes-query';
import {ajesPublicFailureReason,publicAjesReadReceipt} from '@/lib/catalog/ajes-read-receipt';
import {japanVehicleTypeExcluded} from '@/lib/catalog/japan-vehicle-policy';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const p=new URL(request.url).searchParams,market=p.get('market');
 if(!['china','korea','japan'].includes(market||''))return NextResponse.json({error:'invalid_market'},{status:400});
 if(market!=='japan')return NextResponse.json({error:'source_retired'},{status:410,headers:{'Cache-Control':'no-store'}});
 try{
  const result=await readAjesDirectory({market,make:p.get('make')||undefined});
  const models=result.models.filter(row=>row.total>0&&!japanVehicleTypeExcluded({market:'japan',make:row.make,model:row.model}));
  return NextResponse.json({version:1,brands:[],models:models.map(row=>[row.make,row.model,[],row.total]),stale:result.stale},{headers:{'Cache-Control':'no-store'}});
 }catch(error){
  const reason=error instanceof AjesUnavailable?ajesPublicFailureReason(error.reason):error instanceof AjesInputError?'invalid_query':'operation_failed';
  const sourceReceipt=error instanceof AjesUnavailable?publicAjesReadReceipt((error as any).sourceReceipt):undefined;
  console.warn('AJES_DIRECTORY_FAILURE',reason);
  return NextResponse.json({error:'directory_unavailable',reason,...(sourceReceipt?{sourceReceipt}:{})},{status:error instanceof AjesInputError?400:503,headers:{'Cache-Control':'no-store'}});
 }
}
