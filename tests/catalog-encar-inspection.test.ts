import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEncarInspection, matchEncarInspectionVariant} from '../apps/web/lib/catalog/encar-inspection';
const offer: any = {sourceId:'encar_direct',sourceOfferId:'123',market:'korea',year:2023,engineCc:998,fuel:'petrol',powertrainKind:'combustion',operational:{semanticEvidence:{engineCc:{status:'exact',source:'fixture'},fuel:{status:'exact',source:'fixture'}}}};
const html = '<script>window.enlogInitJson={"carid":"123"}</script><table><caption>성능기록부</caption><tr><th>연식</th><td>2023년</td><th>원동기형식</th><td>G3LD</td></tr><tr><th>차대번호</th><td>FIXTUREVIN12345678</td></tr></table>';
// Synthetic matching fixture, never a production horsepower reference.
const variant: any = {id:'fixture/one',modelId:'fixture/model',market:'korea',yearFrom:2022,yearTo:2023,engineCode:'G3LD',engineCc:998,fuel:'petrol',powertrainKind:'combustion',powerHp:76,status:'verified',evidence:[{sourceId:'fixture-manufacturer',status:'verified',confidence:'official',fields:['engineCode','engineCc','fuel','powertrainKind','powerHp','market','yearFrom','yearTo']}]};
test('inspection requires exact listing, year and known VIN; never guesses power',()=>{
 const result=parseEncarInspection(html,offer)!;
 assert.equal(result.engineCode,'G3LD');assert.equal((result as any).powerHp,undefined);
 assert.equal(parseEncarInspection(html,{...offer,sourceOfferId:'124'}),null);
 assert.equal(parseEncarInspection(html,{...offer,year:2022}),null);
 assert.equal(parseEncarInspection(html,{...offer,vin:'OTHER'}),null);
 assert.equal(parseEncarInspection(html.replace('G3LD','G3LD / G3LA'),offer),null);
 assert.equal(parseEncarInspection(html.replace('</tr>','<th>원동기형식</th><td>G3LA</td></tr>'),offer),null);
});
test('document engine code selects only one fully evidenced Korean variant',()=>{
 const row={...offer,operational:{...offer.operational,inspection:parseEncarInspection(html,offer)}};
 assert.equal(matchEncarInspectionVariant(row,[variant],variant.modelId)?.id,variant.id);
 for(const changed of [{market:'china'},{yearTo:2022},{engineCode:'G3LA'},{engineCc:1197},{status:'review'},{evidence:[]}])
  assert.equal(matchEncarInspectionVariant(row,[{...variant,...changed}],variant.modelId),null);
 assert.equal(matchEncarInspectionVariant(row,[variant,{...variant,id:'fixture/two',powerHp:80}],variant.modelId),null);
 assert.equal(matchEncarInspectionVariant({...row,sourceOfferId:'999'},[variant],variant.modelId),null);
 assert.equal(matchEncarInspectionVariant({...row,drive:undefined,bodyType:undefined},[variant],variant.modelId)?.id,variant.id);
});
