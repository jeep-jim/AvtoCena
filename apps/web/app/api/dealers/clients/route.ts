import {createHash} from 'node:crypto';
import {getCurrentUser} from '@/lib/auth';
import {canUseDocuments,documentCompany,workspaceClientsPath} from '@/lib/document-workspace';
import {appendChunkedDataJson} from '@/lib/data';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
export async function POST(request:Request){
 const headers={'Cache-Control':'private, no-store'};
 const user=await getCurrentUser();if(!isCalculationOriginAllowed(request)||!user||!documentCompany(user)||!await canUseDocuments(user))return Response.json({error:'forbidden'},{status:403,headers});
 try{const raw=await request.text();if(raw.length>12000)throw Error();const b=JSON.parse(raw);
 if(typeof b.operationId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(b.operationId))throw Error();
 const fields:Record<string,string>={};for(const k of ['fio','phone','telegram','max','city','car','comment']){if(typeof b[k]!=='string'||b[k].length>(k==='comment'?4000:500))throw Error();fields[k]=b[k].trim();}
 if(!fields.fio&&!fields.phone&&!fields.telegram&&!fields.max)throw Error();
 const budget=Number(b.budgetRub||0);if(!Number.isFinite(budget)||budget<0)throw Error();
 const id='client_'+createHash('sha256').update(JSON.stringify([user.companyId,user.id,b.operationId])).digest('hex');
 const now=new Date().toISOString(),client=await appendChunkedDataJson<any>(workspaceClientsPath(user),{id,companyId:user.companyId,...fields,budgetRub:budget,createdAt:now,updatedAt:now,createdByManagerId:user.id,assignedManagerId:user.id,status:'new',documents:[]});
 return Response.json({id:client.id,client},{headers});
 }catch{return Response.json({error:'client_create_error'},{status:400,headers});}
}
