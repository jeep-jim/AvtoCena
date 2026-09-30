import {NextResponse} from 'next/server';
import {getDealerRate} from '@/lib/dealers/exchange-rate';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(){
 try{return NextResponse.json(await getDealerRate(),{headers:{'Cache-Control':'no-store'}});}
 catch{return NextResponse.json({quote:null,error:'Курс временно недоступен'},{status:503});}
}
