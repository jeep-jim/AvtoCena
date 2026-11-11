export type DealerRequisites = {
  legalName: string; inn: string; ogrn: string; kpp: string; legalAddress: string;
  bank: string; bik: string; account: string; correspondentAccount: string;
};
export type PublicDealerRequisites = Pick<DealerRequisites, 'legalName'|'inn'|'ogrn'|'kpp'|'legalAddress'>;
export const EMPTY_REQUISITES: DealerRequisites = {legalName:'',inn:'',ogrn:'',kpp:'',legalAddress:'',bank:'',bik:'',account:'',correspondentAccount:''};
export function normalizeRequisites(raw: unknown): DealerRequisites {
 const source = raw && typeof raw === 'object' ? raw as Record<string,unknown> : {};
 const result={...EMPTY_REQUISITES};
 for(const key of Object.keys(result) as (keyof DealerRequisites)[]){
  const value=source[key]; if(value!==undefined&&typeof value!=='string')throw Error('Реквизиты нужно указать текстом');
  result[key]=(value as string||'').trim().slice(0,key==='legalName'||key==='legalAddress'||key==='bank'?500:30);
 }
 for(const [key,label,lengths] of [['inn','ИНН',[10,12]],['ogrn','ОГРН / ОГРНИП',[13,15]],['kpp','КПП',[9]],['bik','БИК',[9]],['account','Расчётный счёт',[20]],['correspondentAccount','Корреспондентский счёт',[20]]] as const){
  if(result[key]&&(!/^\d+$/.test(result[key])||!(lengths as readonly number[]).includes(result[key].length)))throw Error(`Проверьте ${label}: ${lengths.join(' или ')} цифр`);
 }
 return result;
}
// Banking details are private. Legal identity is independently stored per dealer.
export function publicRequisites(raw?: DealerRequisites): PublicDealerRequisites {
 const r=raw||EMPTY_REQUISITES;
 return {legalName:r.legalName,inn:r.inn,ogrn:r.ogrn,kpp:r.kpp,legalAddress:r.legalAddress};
}
