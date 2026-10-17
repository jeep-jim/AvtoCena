import test from 'node:test';
import assert from 'node:assert/strict';
import {matchKoreaOfficialPower,enrichEncarOfficialPower,officialKoreanManufacturerBrand} from '../apps/web/lib/catalog/korea-official-power';
const offer=()=>({id:'test',sourceId:'encar_direct',sourceOfferId:'123',market:'korea',make:'Hyundai',model:'Avante (CN7)',year:2021,engineCc:1598,fuel:'petrol',powertrainKind:'combustion',operational:{inspection:{identityVerified:true,sourceOfferId:'123',year:2021,engineCode:'G4FM'},semanticEvidence:{}}}) as any;
test('legal manufacturer names require an explicit matching product family',()=>{
 assert.equal(officialKoreanManufacturerBrand({manufacturer:'한국지엠',model:'트랙스 1.2터보'}),'Chevrolet');
 assert.notEqual(officialKoreanManufacturerBrand({manufacturer:'한국지엠',model:'GMC Sierra'}),'Chevrolet');
 assert.equal(officialKoreanManufacturerBrand({manufacturer:'현대',model:'G80(RG3) 2.5T'}),'Genesis');
 assert.equal(officialKoreanManufacturerBrand({manufacturer:'현대',model:'아반떼'}),'Hyundai');
 assert.notEqual(officialKoreanManufacturerBrand({manufacturer:'기아',model:'G80'}),'Genesis');
 const input=offer();input.make='Renault';input.model='QM6';input.engineCc=1997;input.operational.inspection.engineCode='M5R';
 assert.equal(matchKoreaOfficialPower(input)?.powerHp,144);
 input.make='Chevrolet';input.model='Trax';input.year=2024;input.operational.inspection.year=2024;input.engineCc=1199;input.operational.inspection.engineCode='LIH';
 assert.equal(matchKoreaOfficialPower(input)?.powerHp,139);
});
test('official engine-code consensus supplies Avante power with record-level provenance',()=>{
 const input=offer(),before=JSON.stringify(input),result=enrichEncarOfficialPower(input);
 assert.equal(result.powerHp,123);assert.ok(Math.abs(result.powerKw-90.46634625)<0.000001);
 assert.ok(result.operational.officialPowerEvidence.recordIds.length>0);
 assert.equal(JSON.stringify(input),before);
 const compact={...result,powerKw:Number(result.powerKw.toFixed(2))};
 assert.equal(matchKoreaOfficialPower(compact)?.powerHp,123,'a rounded public projection must not override the exact stored conversion evidence');
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
 const disputed=offer();disputed.powerKw=95;assert.equal(enrichEncarOfficialPower(disputed),disputed);
 const base={id:'1',manufacturer:'현대',model:'아반떼',engineCode:'G4FM',engineCc:1598,fuel:'휘발유',powertrain:'내연기관',output:'123/6300',releaseDate:'20200430',releaseYear:2020};
 assert.equal(matchKoreaOfficialPower(offer(),[base,{...base,id:'2',output:'130/6300'}]),null);
 assert.equal(matchKoreaOfficialPower(offer(),[{...base,output:'unknown'}]),null);
 assert.equal(matchKoreaOfficialPower(offer(),[{...base,releaseYear:2023}]),null);
 assert.equal(matchKoreaOfficialPower(offer(),[base,{...base,id:'hybrid',powertrain:'하이브리드'}]),null);
});
test('model-bound Morning ratings no longer conflict with Ray; Ray year ambiguity remains blocked',()=>{
 const input=offer();input.make='Kia';input.model='Morning III';input.year=2023;input.engineCc=998;input.operational.inspection.year=2023;input.operational.inspection.engineCode='G3LA';
 assert.equal(matchKoreaOfficialPower(input)?.powerHp,76);
 input.model='Ray';assert.equal(matchKoreaOfficialPower(input),null);
 input.model='Unidentified';assert.equal(matchKoreaOfficialPower(input),null);
});
test('narrowing never discards unknown or hybrid records from the same model family',()=>{
 const base={id:'1',manufacturer:'현대',model:'아반떼',engineCode:'G4FM',engineCc:1598,fuel:'휘발유',powertrain:'내연기관',output:'123/6300',releaseDate:'20200430',releaseYear:2020};
 assert.equal(matchKoreaOfficialPower(offer(),[base,{...base,id:'unknown',model:'Unrecognised',output:'150/6300'}]),null);
 assert.equal(matchKoreaOfficialPower(offer(),[base,{...base,id:'hybrid',model:'아반떼 하이브리드',powertrain:'하이브리드'}]),null);
 assert.equal(matchKoreaOfficialPower({...offer(),model:'Ray'},[base]),null);
});
