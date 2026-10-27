import test from 'node:test';
import assert from 'node:assert/strict';
import {parseKoreaInspectionDocument,readKoreaInspectionDocument} from '../apps/web/lib/catalog/korea-report-document';
// Minimal observed markup from the owner's supplier-approved LOT42514287 document.
const html=`<script>window.enlogInitJson={"dataTalkView":{"param":{"carid":"42514287"}}}</script><table><tr><th><em class="txt_name">사고이력</em><a>도움말 보기</a></th><td>없음</td><th><em class="txt_name">단순수리</em></th><td>있음</td></tr></table>`;
const url='https://www.encar.com/md/sl/mdsl_regcar.do?method=inspectionViewNew&carid=42514287';
test('translates explicit inspection findings with their limited meaning, not an insurance verdict',()=>{
 const report=parseKoreaInspectionDocument(html,'42514287')!;
 assert.equal(report.partial,true);assert.deepEqual(report.fields.map(v=>v.value),['Не отмечены','Отмечены']);
 assert.match(report.fields[0].label,/силовых элементов/);assert.equal(report.fields.some(v=>/страх/i.test(v.label)),false);
});
test('unknown/missing facts, wrong identities, conflicting duplicate facts and challenge pages are never clean reports',()=>{
 assert.equal(parseKoreaInspectionDocument(html,'43015054'),null);
 assert.equal(parseKoreaInspectionDocument(html.replaceAll('없음','미확인').replaceAll('있음','미확인'),'42514287'),null);
 assert.equal(parseKoreaInspectionDocument(html+'<th>사고이력</th><td>있음</td>','42514287'),null);
 assert.equal(parseKoreaInspectionDocument(html+'captcha','42514287'),null);
});
test('follows only exact same-car documented redirect and decodes Korean document',async()=>{
 let calls=0;
 const result=await readKoreaInspectionDocument(url,'42514287',async request=>{
  calls++;
  if(calls===1)return new Response(null,{status:302,headers:{location:'/md/sl/mdsl_regcar.do?method=inspectionImgView&ver=v202006&carid=42514287'}});
  assert.match(String(request),/inspectionImgView/);return new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}});
 });assert.equal(calls,2);assert.equal(result?.fields.length,2);
});
test('refusal and wrong-LOT/host redirects stop without fetching their target',async()=>{
 for(const location of ['https://example.com/a','/md/sl/mdsl_regcar.do?method=inspectionImgView&ver=v202006&carid=43015054']){
  let calls=0;assert.equal(await readKoreaInspectionDocument(url,'42514287',async()=>{calls++;return new Response(null,{status:302,headers:{location}});}),null);assert.equal(calls,1);
 }
 let calls=0;assert.equal(await readKoreaInspectionDocument(url,'42514287',async()=>{calls++;return new Response('blocked',{status:403});}),null);assert.equal(calls,1);
});
