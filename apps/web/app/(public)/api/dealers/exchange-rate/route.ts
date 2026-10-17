import {NextResponse} from 'next/server';
import {getDealerRate} from '@/lib/dealers/exchange-rate';
import {getCurrentUser} from '@/lib/auth';
import {canManageDealer} from '@/lib/dealers/access';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(){
 try{return NextResponse.json(await getDealerRate(),{headers:{'Cache-Control':'no-store'}});}
 catch{return NextResponse.json({quote:null,error:'Курс временно недоступен'},{status:503});}
}
export async function POST(req:Request){
 const id=new URL(req.url).searchParams.get('dealerId')||'';
 if(!isCalculationOriginAllowed(req)||!await canManageDealer(await getCurrentUser(),id))return NextResponse.json({error:'Доступ запрещён'},{status:403});
 try{return NextResponse.json(await getDealerRate(true),{headers:{'Cache-Control':'no-store'}});}
 catch{return NextResponse.json({quote:null,error:'Курс временно недоступен'},{status:503});}
}
