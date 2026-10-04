import {NextResponse} from 'next/server';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {cleanShareTarget,createShortShare} from '@/lib/catalog/short-share';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
const buckets=new Map<string,{at:number;count:number}>();
export async function POST(request:Request){
  if(!isCalculationOriginAllowed(request)||request.headers.get('sec-fetch-site')==='cross-site')return NextResponse.json({error:'Недопустимый источник запроса'},{status:403,headers});
  const now=Date.now(),ip=request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown';
  for(const [key,bucket] of buckets)if(now-bucket.at>60000)buckets.delete(key);
  const bucket=buckets.get(ip)||{at:now,count:0};
  if(bucket.count>=30||(!buckets.has(ip)&&buckets.size>=10000))return NextResponse.json({error:'Попробуйте через минуту'},{status:429,headers:{...headers,'Retry-After':'60'}});
  bucket.count++;buckets.set(ip,bucket);
  if(Number(request.headers.get('content-length'))>5000)return NextResponse.json({error:'Слишком большой запрос'},{status:413,headers});
  const body=await request.text();
  if(body.length>5000)return NextResponse.json({error:'Слишком большой запрос'},{status:413,headers});
  let target;
  try{const data=JSON.parse(body);target=cleanShareTarget(data.path,data.mini);}
  catch{return NextResponse.json({error:'Не удалось подготовить ссылку'},{status:400,headers});}
  try{return NextResponse.json({path:await createShortShare(target)},{headers});}
  catch{return NextResponse.json({error:'Не удалось сократить ссылку. Попробуйте ещё раз.'},{status:503,headers});}
}
