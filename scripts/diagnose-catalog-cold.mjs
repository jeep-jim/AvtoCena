import {execFileSync} from 'node:child_process';
await new Promise(r=>setTimeout(r,2500));
let failures=0;
for(const route of ['/cars/autocatalog','/cars/brand/toyota','/cars/brand/toyota/model/land-cruiser-250','/cars/brand/bentley','/cars/brand/bentley/model/continental-gt','/cars/brand/peugeot','/cars/brand/peugeot/model/2008','/api/autocalc/knowledge?q=Peugeot%202008&year=2023','/cars']){
 const start=Date.now();
 try{const response=await fetch('http://127.0.0.1:3100'+route,{signal:AbortSignal.timeout(35000)});const body=await response.text();if(response.status!==200||Date.now()-start>20000||/"digest"|unexpected EOF|Application error/.test(body))failures++;console.log(JSON.stringify({route,status:response.status,bytes:Buffer.byteLength(body),ms:Date.now()-start,streamError:/"digest"|unexpected EOF|Application error/.test(body)}));}
 catch(error){failures++;console.log(JSON.stringify({route,error:String(error),ms:Date.now()-start}));}
 try{console.log(execFileSync('docker',['stats','catalog-cold','--no-stream','--format','{{json .}}'],{encoding:'utf8'}).trim());}catch{}
}

await Promise.all(['/cars/brand/toyota','/cars/brand/peugeot','/cars/brand/bentley','/cars/autocatalog'].map(async route=>{const start=Date.now();try{const response=await fetch('http://127.0.0.1:3100'+route,{signal:AbortSignal.timeout(20000)});const body=await response.text();if(response.status!==200||/\"digest\"|unexpected EOF|Application error/.test(body))failures++;console.log(JSON.stringify({concurrentRoute:route,status:response.status,ms:Date.now()-start}));}catch(error){failures++;console.log(JSON.stringify({concurrentRoute:route,error:String(error)}));}}));
if(failures)throw Error(`cold_catalog_failures:${failures}`);
