export type RegcloudBalance={balance:number;sampledAt:number};
export async function fetchRegcloudBalance(token:string,fetcher:typeof fetch=fetch):Promise<RegcloudBalance>{
 try{
  const r=await fetcher('https://api.cloudvps.reg.ru/v1/balance_data',{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw Error();
  const reader=r.body?.getReader();if(!reader)throw Error();
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>256*1024){await reader.cancel();throw Error();}chunks.push(value);}
  const raw=JSON.parse(Buffer.concat(chunks).toString('utf8'))?.balance_data?.balance;
  // Zero and negative balances are valid. Missing/empty balances are not zero.
  if(!(typeof raw==='number'||typeof raw==='string'&&/^-?\d+(\.\d+)?$/.test(raw))||!Number.isFinite(Number(raw)))throw Error();
  return {balance:Number(raw),sampledAt:Date.now()};
 }catch{throw Error('regcloud_balance_unavailable');}
}
