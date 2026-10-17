import fs from 'node:fs/promises';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';
const headers = { accept:'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8', 'accept-language':'ko-KR,ko;q=0.9,en;q=0.7', 'user-agent':UA, referer:'https://www.kcar.com/bc/search' };
const html = await (await fetch('https://www.kcar.com/bc/search',{headers,redirect:'follow'})).text();
const scripts = [...html.matchAll(/<script\b[^>]*src=["']([^"']+)["']/gi)].map(m=>new URL(m[1], 'https://www.kcar.com').toString());
const matches=[];
for (const url of scripts) {
  let body='';
  try { const r=await fetch(url,{headers,redirect:'follow'}); if(!r.ok) continue; body=await r.text(); } catch { continue; }
  if (!/pagingCarSearchList|carSearchListCount|setEncParam|getAxiosForC2C/i.test(body)) continue;
  const name=url.split('/').pop().split('?')[0] || `bundle-${matches.length}.js`;
  await fs.writeFile(`kcar-${name}`,body);
  const contexts=[];
  for (const keyword of ['pagingCarSearchList','carSearchListCount','setEncParam','getAxiosForC2C','getAxiosForC2c','setEnc','encrypt','componentId','searchCond']) {
    let pos=0,count=0;
    while(count<12){ const i=body.indexOf(keyword,pos); if(i<0) break; contexts.push({keyword,context:body.slice(Math.max(0,i-1800),i+5000)});pos=i+keyword.length;count++; }
  }
  matches.push({url,name,bytes:Buffer.byteLength(body),contexts});
}
await fs.writeFile('kcar-deep-recon.json',JSON.stringify({generatedAt:new Date().toISOString(),scripts:scripts.length,matches},null,2));
console.log(JSON.stringify({scripts:scripts.length,matches:matches.map(x=>({url:x.url,bytes:x.bytes,contexts:x.contexts.map(c=>c.keyword)}))},null,2));
