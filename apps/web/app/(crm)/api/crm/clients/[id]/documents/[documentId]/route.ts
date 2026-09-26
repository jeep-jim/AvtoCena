import {hasCrmPermission} from "@/lib/crm-permissions";
import {recordCrmActivity,activityChanges,activityPerson} from "@/lib/crm-activity";
import {getCurrentUser,isCrmRole} from "@/lib/auth";
import {canSeeLead} from "@/lib/crm-visibility";
import {getJsonStorage,readChunkedDataJson} from "@/lib/data";
import {documentKey,decryptClientDocument,type ClientDocument} from "@/lib/client-documents";
import {changeDocumentState,purgeDocument,documentExpired} from "@/lib/client-document-trash";
import {isCalculationOriginAllowed} from "@/lib/catalog/calculation-request-origin";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{id:string;documentId:string}>}) {
 const user=await getCurrentUser();
 if(!user||!hasCrmPermission(user,"documents")) return new Response(null,{status:401});
 const {id,documentId}=await params;
 const client=(await readChunkedDataJson<any>("clients/clients.json",[])).find(c=>c.id===id);
 if(!client||!canSeeLead(user,client)) return new Response(null,{status:404});
 const doc:ClientDocument|undefined=client.documents?.find((d:ClientDocument)=>d.id===documentId);
 if(!doc||doc.purgeToken||documentExpired(doc)||!/^[a-f0-9-]{36}$/.test(documentId)) return new Response(null,{status:404});
 try {
  const key=documentKey(id,documentId),stored=await getJsonStorage().getBinary?.(key);
  if(!stored) return new Response(null,{status:404});
  const payload=JSON.parse(decryptClientDocument(stored.data,key).toString());
  const query=new URL(request.url).searchParams, thumbnail=query.get("preview")==="1";
  if(thumbnail&&!payload.thumbnail) return new Response(null,{status:404});
  const data=Buffer.from(thumbnail?payload.thumbnail:payload.data,"base64");
  const inline=thumbnail||((doc.mime.startsWith("image/")||doc.mime==="application/pdf")&&query.get("download")!=="1");
  return new Response(new Uint8Array(data),{headers:{
   "Content-Type":thumbnail?"image/webp":doc.mime,"Content-Length":String(data.length),
   "Content-Disposition":`${inline?"inline":"attachment"}; filename="document"; filename*=UTF-8''${encodeURIComponent(doc.name).replace(/['()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
   "Cache-Control":"private, no-store, max-age=0","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer",
   "Content-Security-Policy":"sandbox; default-src 'none'; frame-ancestors 'self'",
  }});
 } catch { return new Response(null,{status:500}); }
}

export async function PATCH(request:Request,{params}:{params:Promise<{id:string;documentId:string}>}) {
 if(!isCalculationOriginAllowed(request))return Response.json({error:"Недопустимый источник запроса."},{status:403});
 const actor=await getCurrentUser();
 if(!actor||!hasCrmPermission(actor,"documents"))return Response.json({error:"Войдите в CRM."},{status:401});
 const body=await request.json().catch(()=>null);
 if(!body||!["trash","restore","purge"].includes(body.action)||(body.action!=="restore"&&body.confirmed!==true))return Response.json({error:"Подтвердите удаление документа."},{status:400});
 const {id,documentId}=await params;
 try{
  const client=(await readChunkedDataJson<any>("clients/clients.json",[])).find(c=>c.id===id);
  const document=client?.documents?.find((d:any)=>d.id===documentId);
  if(body.action==="purge")await purgeDocument(actor,id,documentId);
  else await changeDocumentState(actor,id,documentId,body.action);
  await recordCrmActivity(actor,{type:`document_${body.action}`,title:({trash:"Документ перенесён в архив",restore:"Документ восстановлен",purge:"Документ удалён окончательно"} as Record<string,string>)[body.action],entityType:"document",entityId:documentId,clientId:id,entityLabel:document?.name||"Документ"});
  return Response.json({ok:true},{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  const code=error instanceof Error?error.message:"storage";
  const messages:Record<string,string>={document_forbidden:"Нет доступа к клиенту.",document_not_found:"Документ не найден.",document_purging:"Документ уже удаляется. Восстановление недоступно.",document_expired:"Срок хранения 30 дней истёк.",document_not_trashed:"Сначала переместите документ в корзину."};
  return Response.json({error:messages[code]||"Не удалось сохранить изменение. Попробуйте ещё раз."},{status:code==="document_forbidden"?403:code==="document_not_found"?404:messages[code]?409:500});
 }
}
