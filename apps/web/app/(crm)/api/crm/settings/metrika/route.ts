import {recordCrmActivity} from "@/lib/crm-activity";
import {hasCrmPermission} from "@/lib/crm-permissions";
import {NextResponse} from 'next/server';
import {getCurrentUser,isAdminRole} from '@/lib/auth';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {connectMetrika,disableMetrika,metrikaStatus} from '@/lib/metrika-crm';
export async function GET(){const user=await getCurrentUser();if(!user||!hasCrmPermission(user,"settings"))return NextResponse.json({error:'forbidden'},{status:403});return NextResponse.json(await metrikaStatus(),{headers:{'cache-control':'no-store'}});}
export async function POST(request:Request){
 if(!isCalculationOriginAllowed(request))return NextResponse.json({error:'origin_forbidden'},{status:403});
 const user=await getCurrentUser();if(!user||!hasCrmPermission(user,"settings"))return NextResponse.json({error:'forbidden'},{status:403});
 const body=await request.json().catch(()=>({}));
 try {if(body.action==='disable')await disableMetrika();else await connectMetrika(String(body.token||'').trim());await recordCrmActivity(user,{type:'metrika_changed',title:body.action==='disable'?'Отключена интеграция Метрики':'Подключена интеграция Метрики',visibility:'management',href:'/crm/settings/metrika'});return NextResponse.json(await metrikaStatus(),{headers:{'cache-control':'no-store'}});}
 catch(error){const code=error instanceof Error&&/^(metrika_http_\d+|invalid_token|counter_timezone_missing|encryption_not_configured)$/.test(error.message)?error.message:'connection_failed';return NextResponse.json({error:code},{status:400});}
}
