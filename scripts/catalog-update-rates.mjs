import fs from 'node:fs';
import crypto from 'node:crypto';
import { get } from 'node:https';

const sourceUrl = process.env.CBR_DAILY_XML_URL || 'https://www.cbr.ru/scripts/XML_daily.asp';
const targetCurrencies = new Set(['USD','EUR','CNY','JPY','KRW','AED','VND','KZT']);
const today = new Date().toISOString().slice(0,10);
const outDir = 'data/catalog/rates';
const latest = 'data/catalog/exchange-rates.json';

function fetchText(url){ return new Promise((resolve,reject)=>{ const req=get(url,{headers:{'User-Agent':'AvtoCenaCatalogRates/1.0'}},res=>{ let data=''; res.setEncoding('utf8'); res.on('data',c=>data+=c); res.on('end',()=>res.statusCode && res.statusCode<400 ? resolve(data) : reject(new Error(`HTTP ${res.statusCode}`))); }); req.setTimeout(10000,()=>{req.destroy(new Error('timeout'))}); req.on('error',reject); }); }
function clean(value){ return value.replace(/<[^>]+>/g,'').trim(); }
function parse(xml){ const dateMatch=xml.match(/<ValCurs[^>]*Date="([^"]+)"/); const effectiveFromRaw=dateMatch?.[1]||today; const [dd,mm,yyyy]=effectiveFromRaw.includes('.')?effectiveFromRaw.split('.'):[null,null,null]; const effectiveFrom=yyyy?`${yyyy}-${mm}-${dd}T00:00:00.000Z`:`${today}T00:00:00.000Z`; return [...xml.matchAll(/<Valute[^>]*>([\s\S]*?)<\/Valute>/g)].map(m=>{ const body=m[1]; const currency=clean(body.match(/<CharCode>([\s\S]*?)<\/CharCode>/)?.[1]||''); const nominal=Number(clean(body.match(/<Nominal>([\s\S]*?)<\/Nominal>/)?.[1]||'1').replace(',','.')); const valueRubForNominal=Number(clean(body.match(/<Value>([\s\S]*?)<\/Value>/)?.[1]||'0').replace(',','.')); return { currency, nominal, valueRubForNominal, rateRubPerUnit: valueRubForNominal/nominal, effectiveFrom }; }).filter(r=>targetCurrencies.has(r.currency)); }
try {
 const xml=await fetchText(sourceUrl); const checksum=crypto.createHash('sha256').update(xml).digest('hex'); const fetchedAt=new Date().toISOString(); const rates=parse(xml).map(r=>({...r,fetchedAt,source:'Central Bank of Russia XML_daily',sourceUrl,checksum})); fs.mkdirSync(outDir,{recursive:true}); const snapshot=`${outDir}/rates-${rates[0]?.effectiveFrom.slice(0,10)||today}.json`; fs.writeFileSync(snapshot, JSON.stringify({ source:'cbr', sourceUrl, fetchedAt, checksum, rates }, null, 2)); fs.writeFileSync(latest, JSON.stringify(rates, null, 2)); console.log(JSON.stringify({updated:rates.length,snapshot},null,2));
} catch (error) {
 const fallback=fs.existsSync(latest)?JSON.parse(fs.readFileSync(latest,'utf8')):[]; const ageDays=fallback[0]?.fetchedAt ? Math.round((Date.now()-new Date(fallback[0].fetchedAt).getTime())/864e5) : null; console.log(JSON.stringify({updated:0, fallback:fallback.length, ageDays, error:String(error.message||error)},null,2)); process.exit(fallback.length?0:1);
}
