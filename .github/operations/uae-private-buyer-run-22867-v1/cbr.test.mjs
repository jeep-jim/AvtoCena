import test from 'node:test';
import assert from 'node:assert/strict';
import {datedCbr} from './cbr.mjs';
const r=(code,value)=>'<tr><td>0</td><td>'+code+'</td><td>1</td><td>native</td><td>'+value+'</td></tr>';
const f='<h2>Банк России установил с&nbsp;21.11.2026 следующие курсы иностранных валют</h2><table>'+
 r('AED','22,3801')+r('USD','82,1911')+r('EUR','90,3445')+'</table>';
test('official dated CBR vector comes from matching exact in-body table, not an old cache',()=>{
 const x=datedCbr(Buffer.from(f));
 assert.equal(x.rates.AED.cbrRate,22.3801);assert.equal(x.rates.EUR.rateDate,'2026-11-21');
 assert.throws(()=>datedCbr(Buffer.from(f.replace('21.11.2026','20.11.2026'))),/date/);
 assert.throws(()=>datedCbr(Buffer.from(f.replace('22,3801','22,3800'))),/value_mismatch/);
});
