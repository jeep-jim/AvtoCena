const originalFetch=globalThis.fetch;
globalThis.fetch=async function(input,init){
 const result=await originalFetch(input,init);
 try{const url=new URL(String(input?.url||input));const offset=url.pathname.indexOf('/catalog/');if(offset>=0)console.log(JSON.stringify({catalogRead:url.pathname.slice(offset+1),status:result.status,bytes:Number(result.headers.get('content-length'))||undefined}));}catch{}
 return result;
};
