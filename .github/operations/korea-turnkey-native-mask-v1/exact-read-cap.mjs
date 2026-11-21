// Only the prior six verified checkpoint rows; no arbitrary storage path, writes or supplier transport.
const root='catalog/operations/korea-encar-scoped-source/v1/';
const base=id=>root+id+'/attempt-1/';
const previous=base('44863525814'),last=base('44876364589');
const receipt='3eab3d873416448fd95159c86a6bd9594013e97cb7010761c47649e8de5de98f';
const host='https://s3.regru.cloud';
const scope='/avtocena-staging-8120751/migration-staging/full-20261011/';
const key=(method,path)=>method+' '+host+scope+path;
const small=32*1024,large=12*1024*1024;
const plan=new Map();
const expect=(method,path,n=1,maximum=small)=>plan.set(key(method,path),{n,maximum,method});
expect('HEAD',last+'attempt-417.json',2);
expect('HEAD',root+'continuation-claims/44876364589/'+receipt+'.json');
expect('GET',last+'initial-receipt.json',2);
expect('GET',last+'scope-start.json');
expect('GET',previous+'phase4-receipt.json');
expect('GET',previous+'body-1.json');
for(const [r,idx] of [[previous,2],[previous,792],[previous,1584],[last,1],[last,209],[last,416]]){
 expect('GET',r+'attempt-'+idx+'.json');
 expect('GET',r+'body-'+idx+'.json',1,large);
}
export function guardedCheckpointFetch(fetch,planForTest=plan){
 const remaining=new Map([...planForTest].map(([k,p])=>[k,{...p}]));
 let reads=0, heads=0;
 return {
  async fetch(input,opts={}){
   const requestKey=String(opts.method||'')+' '+String(input);
   const route=remaining.get(requestKey);
   if(!route||route.n<1)throw Error('encar_exact_wire_budget');
   route.n--;if(route.method==='GET')reads++;else heads++;
   const response=await fetch(input,{...opts,redirect:'error'});
   const declared=response.headers.get('content-length');
   if(route.method==='HEAD')return response;
   const comparable=declared==null||/^\d+$/.test(declared)&&Number(declared)<=route.maximum;
   if(!comparable){await response.body?.cancel();throw Error('encar_exact_wire_size');}
   if(!response.body)return response;
   const read=response.body.getReader(), parts=[];let len=0;
   try{
    while(true){const {value,done}=await read.read();if(done)break;
     len+=value.byteLength;
     if(len>route.maximum){await read.cancel();throw Error('encar_exact_wire_size');}
     parts.push(Buffer.from(value));
    }
   }finally{read.releaseLock();}
   return new Response(Buffer.concat(parts,len),{status:response.status,headers:response.headers});
  },
  finish(){
   if([...remaining.values()].some(p=>p.n!==0))throw Error('encar_exact_wire_incomplete');
   return {actualObjectGets:reads,actualObjectHeads:heads};
  }
 };
}
