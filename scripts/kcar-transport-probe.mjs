import crypto from 'node:crypto';
import net from 'node:net';
const headers={accept:'application/json, text/plain, */*','accept-language':'ko-KR,ko;q=0.9,en;q=0.7',origin:'https://www.kcar.com',referer:'https://www.kcar.com/bc/search','user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36','content-type':'application/json'};
const data={wr_in_multi_columns:'cntr_rgn_cd|cntr_cd',pageno:1,limit:20,orderFlag:true,orderBy:'time_deal_yn:desc|time_deal_end_dt:asc|promo_ordr:asc|event_ordr:asc|sort_ordr:asc'};
const cipher=crypto.createCipheriv('aes-128-cbc',Buffer.from('SKFJ2424DasfaJRI'),Buffer.from('sfq241sf3dscs321'));
const body=JSON.stringify({enc:Buffer.concat([cipher.update(JSON.stringify(data)),cipher.final()]).toString('base64')});
for(const timeout of [net.getDefaultAutoSelectFamilyAttemptTimeout(),2000]){
 net.setDefaultAutoSelectFamilyAttemptTimeout(timeout);const start=Date.now();
 try{const r=await fetch('https://api.kcar.com/bc/search/list/drct',{method:'POST',headers,body,signal:AbortSignal.timeout(30000)});const text=await r.text();let json;try{json=JSON.parse(text);}catch{}
 const root=json?.data?.data??json?.data;console.log(JSON.stringify({timeout,ms:Date.now()-start,status:r.status,success:json?.success,total:root?.totalCnt,rows:root?.rows?.length,contentType:r.headers.get('content-type')}));
 if([401,403,429].includes(r.status)||/captcha|access denied|has_been_cr_blocked/i.test(text.slice(0,2000)))break;
 if(r.ok&&root?.rows?.length)break;
 }catch(e){console.log(JSON.stringify({timeout,ms:Date.now()-start,error:e.message,cause:e.cause?.code,errors:e.cause?.errors?.map(x=>({code:x.code,address:x.address}))}));}
}
