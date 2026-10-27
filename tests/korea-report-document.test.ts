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

import {readFileSync} from 'node:fs';
import {validKoreaReportLink} from '../apps/web/lib/catalog/korea-report-types';
const structured=readFileSync('tests/fixtures/korea-inspection-structured.html','utf8');
test('observed structured inspection preserves selected states, rowspan systems and actual changed body part',()=>{
 const doc=parseKoreaInspectionDocument(structured,'43015054')!;
 const value=(key:string)=>doc.fields.find(f=>f.key===key)?.value;
 assert.equal(value('structuralDamage'),'Не отмечены');assert.equal(value('panelRepair'),'Отмечены');
 assert.equal(value('odometer'),'Исправно');assert.equal(value('mileage'),'83045 км');
 assert.equal(value('firstRegistration'),'16.02.2022');assert.equal(value('inspectionDate'),'23.10.2026');
 assert.match(value('insuranceNote')!,/Случаи и суммы.*не приведены/);
 assert.equal(doc.fields.filter(f=>f.group).length,33);
 assert.equal(doc.fields.some(f=>f.label==='Сцепление'),false,'neither checkbox is selected');
 assert.deepEqual(doc.body?.parts.filter(p=>p.conditions.length),[{key:'frontFenderLeft',conditions:['CHANGE']}]);
 assert.equal(doc.body?.unmapped,false);
 assert.ok(doc.fields.some(f=>f.group==='Двигатель'&&f.label==='Утечка масла · Головка блока / прокладка'));
 assert.ok(doc.fields.some(f=>f.group==='Двигатель'&&f.label==='Утечка охлаждающей жидкости · Головка блока / прокладка'));
 assert.ok(doc.fields.some(f=>f.group==='Коробка передач'&&f.label==='АКПП · Работа на холостом ходу'));
 assert.equal(doc.fields.some(f=>/ДТП нет|Страховых случаев нет/.test(f.value)),false);
});
test('only chosen flags count; ambiguous flags and unsupported part states stay unknown',()=>{
 const h=structured.replaceAll('<span class="txt_state">있음</span>','<span class="txt_state on">있음</span>');
 const doc=parseKoreaInspectionDocument(h,'43015054')!;
 assert.equal(doc.fields.find(f=>f.key==='useChange'),undefined,'two selected flags cannot become absence');
 const invalid=structured.replace('"frontFenderLeft":["CHANGE"]','"frontFenderLeft":["ALIEN"]');
 const parsed=parseKoreaInspectionDocument(invalid,'43015054')!;
 assert.equal(parsed.body?.unmapped,true);assert.equal(parsed.body?.parts.some(p=>p.key==='frontFenderLeft'),false);
 const duplicate=structured.replace('"frontFenderLeft":["CHANGE"]','"frontFenderLeft":["CHANGE"],"frontFenderLeft":null');
 assert.equal(parseKoreaInspectionDocument(duplicate,'43015054')?.body,undefined);
 const wrong=structured.replace('"carid":"43015054"','"carid":"42514287"');
 assert.equal(parseKoreaInspectionDocument(wrong,'43015054'),null);
});
test('local UI boundary rejects malformed documents rather than throwing while rendering',()=>{
 const doc=parseKoreaInspectionDocument(structured,'43015054')!;
 const value={version:2,offerId:'ajes-korea-fixture',lot:'43015054',kind:'inspection',href:'https://www.encar.com/md/sl/mdsl_regcar.do?method=inspectionViewNew&carid=43015054',originalHref:'https://www.encar.com/md/sl/mdsl_regcar.do?method=inspectionViewNew&carid=43015054',document:doc};
 const valid=(document:unknown)=>validKoreaReportLink({...value,document},value.offerId,value.lot,'inspection');
 assert.equal(valid(doc),true);
 for(const document of [{...doc,lot:'42514287'},{...doc,kind:'history'},{...doc,fields:null},{...doc,fields:[{key:'x',label:[],value:'x'}]},{...doc,body:{parts:[{key:'__proto__',conditions:[]}],unmapped:false}},{...doc,body:{parts:[{key:'hood',conditions:['unknown']}],unmapped:false}}])assert.equal(valid(document),false);
});
