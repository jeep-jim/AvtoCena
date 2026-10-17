import fs from 'node:fs/promises';

const BASE='https://jpauc.com';
const H={accept:'application/json,text/plain,*/*','accept-language':'en-US,en;q=0.9,ja;q=0.8','cache-control':'no-cache',pragma:'no-cache',referer:'https://jpauc.com/auction/past','user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'};
const cases=[
 {code:'LA350S',date:'2026-08-03',auction:'AUCNET',lot:'25144',dataId:'343869103'},
 {code:'S321V',date:'2026-08-03',auction:'AUCNET',lot:'25143',dataId:'343869105'},
 {code:'DMEJ3R',date:'2026-08-03',auction:'AUCNET',lot:'34515',dataId:'343869106'},
];
function clean(v){return String(v??'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()}
function money(v){const s=clean(v);const m=s.match(/(?:¥|JPY)?\s*([0-9][0-9,]*)/i);return m?Number(m[1].replace(/,/g,'')):0}
function rowsOf(j){if(Array.isArray(j))return j;if(Array.isArray(j?.result))return j.result;if(Array.isArray(j?.data))return j.data;for(const v of Object.values(j||{}))if(Array.isArray(v))return v;return[]}
const out={generatedAt:new Date().toISOString(),cases:[]};
for(const c of cases){
 const url=`${BASE}/API/auction/history/${encodeURIComponent(c.code)}`;
 try{
  const r=await fetch(url,{headers:H,redirect:'follow',signal:AbortSignal.timeout(30000)});const body=await r.text();let json=null;try{json=JSON.parse(body)}catch{}
  const rows=rowsOf(json).map(x=>({keys:Object.keys(x||{}),lot_date:clean(x?.lot_date??x?.date??x?.auction_date),auction_name:clean(x?.auction_name??x?.auction??x?.venue),lot_no:clean(x?.lot_no??x?.lot_number??x?.lot),result_en:clean(x?.result_en??x?.result??x?.status),end_price_en:clean(x?.end_price_en??x?.end_price??x?.final_price??x?.sold_price),endPrice:money(x?.end_price_en??x?.end_price??x?.final_price??x?.sold_price),frame:clean(x?.vin??x?.frame??x?.chassis),model:clean(x?.model??x?.model_name),grade:clean(x?.grade_en??x?.grade),raw:x}));
  const match=rows.filter(x=>(!x.lot_date||x.lot_date.includes(c.date))&&(!x.lot_no||x.lot_no===c.lot)&&(!x.auction_name||x.auction_name.toLowerCase().includes(c.auction.toLowerCase())||c.auction.toLowerCase().includes(x.auction_name.toLowerCase())));
  out.cases.push({...c,url,status:r.status,contentType:r.headers.get('content-type')||'',bytes:body.length,preview:body.slice(0,1200),rowCount:rows.length,rows:rows.slice(0,30),matches:match});
 }catch(e){out.cases.push({...c,url,error:String(e?.message||e)})}
}
await fs.writeFile('jpauc-history-code-probe.json',JSON.stringify(out,null,2));
console.log(JSON.stringify({generatedAt:out.generatedAt,cases:out.cases.map(c=>({code:c.code,status:c.status,contentType:c.contentType,bytes:c.bytes,rowCount:c.rowCount,error:c.error,matches:c.matches}))},null,2));
