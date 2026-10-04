export function accountCanAccessClient(accountId:string,client:any){return Boolean(accountId&&client&&!client.deletedAt&&client.portalAccountId===accountId);}
export function canClaimCustomerInvite(accountId:string,client:any,tokenHash:string,now=Date.now()){
 return Boolean(client&&!client.deletedAt&&(!client.portalAccountId||client.portalAccountId===accountId)&&client.portalInvite?.hash===tokenHash&&Number.isFinite(Date.parse(client.portalInvite?.expiresAt))&&Date.parse(client.portalInvite.expiresAt)>now);
}
export function sharedCustomerDocuments(client:any){return (client?.documents||[]).filter((d:any)=>d.customerVisible===true&&!d.deletedAt&&!d.purgeToken);}
export function confirmedCustomerContract(client:any,leadId:string){const c=client?.portalContracts?.[leadId];return c&&!c.revokedAt&&c.confirmedBy&&Number.isFinite(Date.parse(c.confirmedAt))&&sharedCustomerDocuments(client).some((d:any)=>d.id===c.documentId)?c:null;}
