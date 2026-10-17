import {dealerClientReady} from './dealers/client-workflow';
import {workspaceClientsPath,canAccessDocumentClient} from "./document-workspace";
import {randomUUID} from "node:crypto";
import type {AuthUser} from "./auth";
import {canSeeLead} from "./crm-visibility";
import {getJsonStorage,readDataJson,readChunkedDataJson,updateChunkedDataJson} from "./data";
import {documentKey,type ClientDocument} from "./client-documents";
export const DOCUMENT_RETENTION_MS=30*24*60*60*1000;
export function documentExpired(doc:ClientDocument,now=Date.now()) {
 const deleted=Date.parse(doc.deletedAt||"");
 return Number.isFinite(deleted)&&deleted+DOCUMENT_RETENTION_MS<=now;
}
function authorize(actor:AuthUser|null,client:any,system:boolean) {
 if(!system&&!canAccessDocumentClient(actor,client))throw Error("document_forbidden");
}
export async function changeDocumentState(actor:AuthUser,clientId:string,id:string,action:"trash"|"restore",now=Date.now()) {
 if(actor.role==='dealer'){const client=(await readChunkedDataJson<any>(workspaceClientsPath(actor),[])).find(c=>c.id===clientId);if(!await dealerClientReady(actor,client))throw Error('document_forbidden');}
 let result:ClientDocument|undefined;
 const updated=await updateChunkedDataJson<any>(workspaceClientsPath(actor),clientId,current=>{
  authorize(actor,current,false);
  const doc:ClientDocument|undefined=current.documents?.find((d:ClientDocument)=>d.id===id);
  if(!doc)throw Error("document_not_found");
  if(doc.purgeToken)throw Error("document_purging");
  if(action==="restore"&&documentExpired(doc,now))throw Error("document_expired");
  result=action==="trash"?doc.deletedAt?doc:{...doc,deletedAt:new Date(now).toISOString(),deletedBy:actor.id}:{...doc,deletedAt:undefined,deletedBy:undefined};
  return {...current,documents:current.documents.map((d:ClientDocument)=>d.id===id?result:d),documentsUpdatedAt:new Date(now).toISOString(),documentsUpdatedByManagerId:actor.id};
 });
 if(!updated||!result)throw Error("document_not_found");
 return result;
}
/** A purge claim blocks restore while storage deletion is in flight; failed purges can be retried. */
export async function purgeDocument(actor:AuthUser|null,clientId:string,id:string,options:{expiredOnly?:boolean;now?:number;clientPath?:string}={}) {
 const now=options.now??Date.now(),system=actor===null&&options.expiredOnly===true;
 const clientPath=system&&options.clientPath?options.clientPath:workspaceClientsPath(actor);
 if(!system&&actor?.role==='dealer'){const client=(await readChunkedDataJson<any>(clientPath,[])).find(c=>c.id===clientId);if(!await dealerClientReady(actor,client))throw Error('document_forbidden');}
 let token="",claimed=false;
 const updated=await updateChunkedDataJson<any>(clientPath,clientId,current=>{
  authorize(actor,current,system);
  const doc:ClientDocument|undefined=current.documents?.find((d:ClientDocument)=>d.id===id);
  if(!doc)throw Error("document_not_found");
  if(!doc.deletedAt)throw Error("document_not_trashed");
  if(options.expiredOnly&&!documentExpired(doc,now)&&!doc.purgeToken)throw Error("document_not_expired");
  token=doc.purgeToken||randomUUID();claimed=true;
  return {...current,documents:current.documents.map((d:ClientDocument)=>d.id===id?{...d,purgeToken:token}:d)};
 });
 if(!updated||!claimed)throw Error("document_not_found");
 const storage=getJsonStorage();if(!storage.deleteBinary)throw Error("storage_unavailable");
 await storage.deleteBinary(documentKey(clientId,id));
 await updateChunkedDataJson<any>(clientPath,clientId,current=>({...current,documents:(current.documents||[]).filter((d:ClientDocument)=>!(d.id===id&&d.purgeToken===token)),documentsUpdatedAt:new Date(now).toISOString()}));
}
export async function purgeExpiredDocuments(now=Date.now()) {
 const dealers=await readDataJson<{id:string}[]>("dealers/dealers.json",[]);
 const paths=["clients/clients.json",...dealers.filter(d=>d.id!=="dealer_topavto").map(d=>`dealers/${encodeURIComponent(d.id)}/clients.json`)];
 const clients=(await Promise.all(paths.map(async clientPath=>(await readChunkedDataJson<any>(clientPath,[])).map(c=>({...c,clientPath}))))).flat();
 let deleted=0;const failed:Array<{clientId:string;documentId:string}>=[];
 for(const client of clients)for(const doc of (client.documents||[]) as ClientDocument[]){
  if(!doc.deletedAt||(!documentExpired(doc,now)&&!doc.purgeToken))continue;
  try{await purgeDocument(null,client.id,doc.id,{expiredOnly:true,now,clientPath:client.clientPath});deleted++;}
  catch(e){if(e instanceof Error&&["document_not_found","document_not_trashed","document_not_expired"].includes(e.message))continue;failed.push({clientId:client.id,documentId:doc.id});}
 }
 return {deleted,failed};
}
