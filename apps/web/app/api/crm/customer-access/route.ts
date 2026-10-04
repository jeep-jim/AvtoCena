import {readAccountJson} from '@/lib/account/request';
import {randomBytes} from 'node:crypto';
import {getCurrentUser} from '@/lib/auth';
import {canUseDocuments,workspaceClientsPath,canAccessDocumentClient,documentCompany} from '@/lib/document-workspace';
import {readChunkedDataJson,readRecentChunkedDataJson,updateChunkedDataJson} from '@/lib/data';
import {hash} from '@/lib/account/auth';
import {customerLeads,threadPath,sendPortalMessage} from '@/lib/account/portal';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
async function context(id:string){const user=await getCurrentUser();if(!user||!await canUseDocuments(user))throw Error('Нет доступа.');const path=workspaceClientsPath(user),company=documentCompany(user)||'dealer_topavto';const client=(await readChunkedDataJson<any>(path,[])).find(c=>c.id===id);if(!client||!canAccessDocumentClient(user,client))throw Error('Нет доступа.');return {user,path,company,client};}
export async function GET(request:Request){try{const {client,company}=await context(new URL(request.url).searchParams.get('clientId')||'');return Response.json({linked:!!client.portalAccountId,messages:(await readRecentChunkedDataJson<any>(threadPath(company,client.id),100)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt))},{headers});}catch{return new Response(null,{status:403});}}
export async function POST(request:Request){if(!isCalculationOriginAllowed(request))return new Response(null,{status:403});try{const b=await readAccountJson(request);const {user,path,company,client}=await context(b.clientId);let result:any={ok:true};
 if(b.action==='invite'){const token=randomBytes(24).toString('hex');await updateChunkedDataJson<any>(path,client.id,c=>{if(!canAccessDocumentClient(user,c))throw Error('Нет доступа.');return {...c,portalInvite:{hash:hash(token),expiresAt:new Date(Date.now()+86400000).toISOString(),createdBy:user.id}};});result.url=`https://avtocena.com/account?invite=${company}.${client.id}.${token}`;}
 else if(b.action==='message'){if(!client.portalAccountId)throw Error('Клиент ещё не подключил кабинет.');await sendPortalMessage(company,client.id,b.text,user.displayName);}
 else if(b.action==='share'){await updateChunkedDataJson<any>(path,client.id,c=>{if(!canAccessDocumentClient(user,c))throw Error('Нет доступа.');if(!c.documents?.some((d:any)=>d.id===b.documentId&&!d.deletedAt))throw Error('Документ не найден.');return {...c,documents:c.documents.map((d:any)=>d.id===b.documentId?{...d,customerVisible:b.visible===true}:d)};});}
 else if(b.action==='confirm_contract'){
 if(b.confirmed!==true)throw Error('Подтвердите подписание договора.');
 const lead=(await customerLeads(company,client.id)).find(l=>l.id===b.leadId);
 const document=client.documents?.find((d:any)=>d.id===b.documentId&&!d.deletedAt&&d.customerVisible);if(!lead||!document)throw Error('Выберите заявку и открытый клиенту документ договора.');
 await updateChunkedDataJson<any>(path,client.id,c=>{if(!canAccessDocumentClient(user,c))throw Error('Нет доступа.');return {...c,portalContracts:{...c.portalContracts,[lead.id]:{documentId:document.id,dealerId:lead.requestedDealerId||lead.dealerId||company,confirmedBy:user.id,confirmedAt:new Date().toISOString()}}};});
 }else throw Error('Неизвестное действие.');return Response.json(result,{headers});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Не удалось сохранить.'},{status:400,headers});}}
