import test from 'node:test';
import assert from 'node:assert/strict';
import {matchKoreaOfficialPower,enrichEncarOfficialPower} from '../apps/web/lib/catalog/korea-official-power';
const offer=()=>({id:'test',sourceId:'encar_direct',sourceOfferId:'123',market:'korea',make:'Hyundai',model:'Avante (CN7)',year:2021,engineCc:1598,fuel:'petrol',powertrainKind:'combustion',operational:{inspection:{identityVerified:true,sourceOfferId:'123',year:2021,engineCode:'G4FM'},semanticEvidence:{}}}) as any;
test('official engine-code consensus supplies Avante power with record-level provenance',()=>{
 const input=offer(),before=JSON.stringify(input),result=enrichEncarOfficialPower(input);
 assert.equal(result.powerHp,123);assert.ok(Math.abs(result.powerKw-90.46634625)<0.000001);
 assert.ok(result.operational.officialPowerEvidence.recordIds.length>0);
 assert.equal(JSON.stringify(input),before);
});
test('same engine family with conflicting government ratings is not guessed',()=>{
 const input=offer();input.make='Kia';input.engineCc=998;input.operational.inspection.engineCode='G3LA';
 assert.equal(matchKoreaOfficialPower(input),null);
});
test('wrong identity, fuel, displacement, market, or a disputed source rating cannot be overwritten',()=>{
 for(const change of [o=>o.operational.inspection.sourceOfferId='other',o=>o.operational.inspection.identityVerified=false,o=>o.operational.inspection.year=2022,o=>o.fuel='diesel',o=>o.engineCc=1600,o=>o.make='Kiax',o=>o.market='china',o=>o.powertrainKind='other_hybrid',o=>o.powerHp=200,o=>o.operational.semanticEvidence.powerHp={status:'conflict'}]){
  const input=offer();change(input);assert.equal(enrichEncarOfficialPower(input),input);
 }
});
test('absent or malformed official output and multiple ratings fail closed',()=>{
 const base={id:'1',manufacturer:'현대',model:'아반떼',engineCode:'G4FM',engineCc:1598,fuel:'휘발유',powertrain:'내연기관',output:'123/6300',releaseDate:'20200430',releaseYear:2020};
 assert.equal(matchKoreaOfficialPower(offer(),[base,{...base,id:'2',output:'130/6300'}]),null);
 assert.equal(matchKoreaOfficialPower(offer(),[{...base,output:'unknown'}]),null);
 assert.equal(matchKoreaOfficialPower(offer(),[{...base,releaseYear:2023}]),null);
});
