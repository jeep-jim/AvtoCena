import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {CBR_21_NOV,FX_KEY} from './qualify.mjs';
export const CBR_URL='https://www.cbr.ru/currency_base/daily/?UniDbQuery.Posted=True&UniDbQuery.To=21.11.2026';
const sha=b=>createHash('sha256').update(b).digest('hex');
const text=x=>x.replace(/<[^>]*>/g,'').replace(/&nbsp;|\u00a0/g,' ').trim();
export function datedCbr(html){
 assert.ok(Buffer.isBuffer(html)&&html.length>0&&html.length<=512*1024,'uae_cbr_wire_size');
 const body=html.toString('utf8');
 assert.ok(/с\s+21\.11\.2026\s+следующие\s+курсы/i.test(text(body)),'uae_cbr_wrong_effective_date');
 const seen={};
 for(const r of body.matchAll(/<tr(?:\s[^>]*)?>([\s\S]*?)<\/tr>/gi)){
   const cells=[...r[1].matchAll(/<td(?:\s[^>]*)?>([\s\S]*?)<\/td>/gi)].map(s=>text(s[1]));
   if(!['AED','USD','EUR'].includes(cells[1]))continue;
   assert.ok(cells.length===5&&cells[2]==='1'&&!seen[cells[1]]&&/^\d+,\d{4}$/.test(cells[4]),'uae_cbr_exact_table_shape');
   const code=cells[1], cbrRate=Number(cells[4].replace(',','.'));
   assert.equal(cbrRate,CBR_21_NOV[code],'uae_cbr_reference_value_mismatch');
   seen[code]={currency:code,nominal:1,cbrRate,rateDate:CBR_21_NOV.rateDate,rateSource:'cbr'};
 }
 assert.ok(['AED','USD','EUR'].every(k=>seen[k]),'uae_cbr_missing_currency');
 const wireSha256=sha(html);
 // Job envelope only, never regulatory/contractual acceptance of a quote.
 return {key:FX_KEY,wireSha256,etagSha256:wireSha256,transport:'official_cbr_dated_https_body',
  validThrough:'2026-11-22T00:00:00Z',rates:seen};
}
