import {createHash,randomBytes} from 'node:crypto';
import {NextResponse} from 'next/server';
import {readDataJson,mutateDataJson} from '@/lib/data';
import {readShowcase,validDealerId} from '@/lib/dealers/showcase-store';
import {availableShowcase} from '@/lib/dealers/program-store';
import {canManageDealer} from '@/lib/dealers/access';
import {getCurrentUser} from '@/lib/auth';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {emptyDealerSubscriptions,subscriptionState,updateSubscription,type DealerSubscriptions} from '@/lib/dealers/subscription-model';
export const runtime='nodejs';export const dynamic='force-dynamic';
const COOKIE='ac_dealer_subscriber';
function identity(req:Request){const current=req.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);const token=current&&/^[a-f0-9]{64}$/.test(current)?current:randomBytes(32).toString('hex');return {token,key:createHash('sha256').update(token).digest('hex'),fresh:token!==current};}
async function allowed(id:string){if(!validDealerId(id))return false;const s=await readShowcase(id);if(!s)return false;return (await availableShowcase(s)).profileEnabled||await canManageDealer(await getCurrentUser(),id);}
function response(value:unknown,who:ReturnType<typeof identity>){const res=NextResponse.json(value,{headers:{'Cache-Control':'private, no-store'}});if(who.fresh)res.cookies.set(COOKIE,who.token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:60*60*24*365});return res;}
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;if(!await allowed(id))return NextResponse.json({error:'Компания недоступна'},{status:404});const who=identity(req),value=await readDataJson<DealerSubscriptions>(`dealers/subscriptions/${id}.json`,emptyDealerSubscriptions());return response(subscriptionState(value,who.key),who);}
export async function PUT(req:Request,{params}:{params:Promise<{id:string}>}){if(!isCalculationOriginAllowed(req)||req.headers.get('sec-fetch-site')==='cross-site')return NextResponse.json({error:'Доступ запрещён'},{status:403});const {id}=await params;if(!validDealerId(id))return NextResponse.json({error:'Компания недоступна'},{status:404});if(Number(req.headers.get('content-length'))>1024)return NextResponse.json({error:'Некорректный запрос'},{status:400});let body;try{const text=await req.text();if(text.length>1024)throw Error();body=JSON.parse(text);}catch{return NextResponse.json({error:'Некорректный запрос'},{status:400});}if(typeof body?.subscribed!=='boolean')return NextResponse.json({error:'Укажите состояние подписки'},{status:400});if(body.subscribed&&!await allowed(id))return NextResponse.json({error:'Компания недоступна'},{status:404});const who=identity(req);let result=subscriptionState(emptyDealerSubscriptions(),who.key);await mutateDataJson<DealerSubscriptions>(`dealers/subscriptions/${id}.json`,emptyDealerSubscriptions(),current=>{const next=updateSubscription(current,who.key,body.subscribed);result=subscriptionState(next,who.key);return next;});return response(result,who);}
