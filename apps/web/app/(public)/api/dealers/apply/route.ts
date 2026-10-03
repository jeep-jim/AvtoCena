import crypto from 'node:crypto';
import {appendChunkedDataJson} from '@/lib/data';
import {readPublicFeatures} from '@/lib/dealers/showcase-store';
import {getCurrentUser} from '@/lib/auth';
import {isPlatformOwner} from '@/lib/platform-access';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {partnerLanguage} from '@/lib/partners/content';
const clean=(v:FormDataEntryValue|null,n=180)=>typeof v==='string'?v.trim().replace(/\s+/g,' ').slice(0,n):'';
export async function POST(req:Request){
 if(!isCalculationOriginAllowed(req))return Response.json({error:'origin_forbidden'},{status:403});
 if(Number(req.headers.get('content-length'))>20000)return Response.json({error:'too_large'},{status:413});
 try{
  const form=await req.formData(),f=await readPublicFeatures();const preview=clean(form.get('preview'))==='1'&&isPlatformOwner(await getCurrentUser());
  const directory=clean(form.get('source'))==='dealer_directory';
  if(!f.partnersEnabled&&!preview&&!directory)return Response.json({error:'page_unavailable'},{status:404});
  const companyName=clean(form.get('companyName')),city=clean(form.get('city')),country=clean(form.get('country')),contactName=clean(form.get('contactName')),contact=clean(form.get('contact'))||clean(form.get('phone')),consent=clean(form.get('consent'))==='yes';
  if(!companyName||!city||!country||!contactName||!contact||!consent||(!contact.includes('@')&&contact.replace(/\D/g,'').length<7))return Response.json({error:'required_fields_missing'},{status:400});
  if(!clean(form.get('website'))&&!preview)await appendChunkedDataJson('dealers/applications.json',{id:`dealer_application_${crypto.randomUUID()}`,companyName,city,country,contactName,phone:contact.includes('@')?'':contact,email:contact.includes('@')?contact:'',telegram:clean(form.get('telegram')),markets:clean(form.get('markets'),1500),partnerType:clean(form.get('partnerType'))==='supplier'?'supplier':'dealer',lang:partnerLanguage(clean(form.get('lang'))),status:'new',source:directory?'dealer_directory':'partner_landing',consentAt:new Date().toISOString(),createdAt:new Date().toISOString()});
  if(req.headers.get('accept')?.includes('application/json'))return Response.json({ok:true,preview},{headers:{'Cache-Control':'no-store'}});
  return new Response(null,{status:303,headers:{Location:directory?'/dealers?sent=1#dealer-apply':'/partners?sent=1#connect'}});
 }catch{return Response.json({error:'invalid_request'},{status:400});}
}
