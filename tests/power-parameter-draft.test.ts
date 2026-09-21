import test from 'node:test';
import assert from 'node:assert/strict';
import {completePowerUnitDraft, powerUnitPatch, hybridResearchQuery, electricResearchQuery} from '../apps/web/lib/catalog/power-parameter-draft';
import {validateCustomerParameters} from '../apps/web/lib/catalog/customer-parameters';
test('hybrid power pairs convert independently and preserve entered kW', () => {
 const draft = completePowerUnitDraft({powerHp:'49',icePowerKw:'36',power30MinKw:'1'});
 assert.equal(draft.icePowerKw,'36');
 assert.equal(draft.power30MinKw,'1');
 assert.ok(Math.abs(Number(draft.icePowerHp)*0.73549875-36)<1e-7);
 const changed={...draft,...powerUnitPatch('power30MinHp','10')};
 assert.equal(changed.power30MinKw,'7.3549875');
 assert.equal(changed.icePowerKw,'36');
 assert.equal(changed.powerHp,'49');
});
test('empty, zero and invalid power clear the paired field without a stale calculation', () => {
 for(const value of ['', '0', 'NaN', '-1']) assert.equal(powerUnitPatch('icePowerHp',value).icePowerKw,'');
 assert.equal(powerUnitPatch('power30MinHp','2,5').power30MinKw,'1.83874688');
});
test('general power cannot supply missing certified motor or engine power', () => {
 const draft=completePowerUnitDraft({powerHp:'150'});
 assert.equal(draft.power30MinKw,undefined);
 assert.equal(draft.icePowerKw,undefined);
});
test('paired hybrid input reaches calculation with separate engine and certified motor values', () => {
 const draft={year:'2024',fuel:'hybrid',hybridKind:'other_hybrid',engineCc:'658',powerHp:'49',
  ...powerUnitPatch('icePowerHp','49'),...powerUnitPatch('power30MinHp','2')};
 const validated=validateCustomerParameters(draft);
 assert.equal(validated.icePowerKw,36.03943875);
 assert.equal(validated.power30MinKw,1.4709975);
});
test('research prompt identifies the car and asks for evidence rather than inferred peak power', () => {
 const query=hybridResearchQuery('Suzuki Spacia HYBRID G MK53S','2024','658');
 assert.match(query,/Suzuki Spacia HYBRID G MK53S 2024 658/);
 assert.match(query,/30-минутную/);assert.match(query,/номера документов/);assert.match(query,/данных нет/);
});

test('electric research preserves identity without requesting hybrid classification', () => {
 const query=electricResearchQuery('Nissan Sakura X B6AW','2025');
 assert.match(query,/Nissan Sakura X B6AW 2025/);assert.match(query,/электромобиль без ДВС/);
 assert.match(query,/Нет подтверждённых данных/);assert.doesNotMatch(query,/см³|определить.*тип гибрида/);
 const draft={year:'2025',fuel:'electric',powerHp:'64',power30MinKw:'20',...powerUnitPatch('power30MinKw','')};
 assert.equal(draft.power30MinKw,'');assert.equal(draft.power30MinHp,'');
 assert.throws(()=>validateCustomerParameters(draft));
});
