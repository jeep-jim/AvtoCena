import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogSearchProjectionMatches} from '../apps/web/lib/catalog/storage';
import {filterGreenCorner} from '../apps/web/lib/catalog/green-corner-search';
import {ajesQuery} from '../apps/web/lib/catalog/ajes-query';
import {ajesResultFilter} from '../apps/web/lib/catalog/ajes-result-filter';
import {catalogFilterOptions} from '../apps/web/lib/catalog/filter-options';
import {matchesFuelFilter,isElectrifiedFilter} from '../apps/web/lib/catalog/fuel-filter';
const selection={bodyType:'sedan|hatchback',transmission:'automatic|cvt',fuel:'petrol|diesel',drive:'fwd|awd'};
const first:any={id:'green-123',market:'japan',make:'Honda',model:'STEPWGN',year:2024,bodyType:'sedan',transmission:'automatic',fuel:'petrol',drive:'fwd'};
const second:any={...first,id:'green-124',bodyType:'hatchback',transmission:'cvt',fuel:'diesel',drive:'awd'};
test('all six projection markets and Green Corner OR each field and AND across fields',()=>{
 for(const market of ['japan','china','korea','uae','europe','georgia']){
  for(const row of [first,second])assert.equal(catalogSearchProjectionMatches({...row,market},selection),true,market);
  for(const change of [{bodyType:'coupe'},{transmission:'manual'},{fuel:'electric'},{drive:'rwd'}])assert.equal(catalogSearchProjectionMatches({...first,...change,market},selection),false,market+JSON.stringify(change));
 }
 assert.deepEqual(filterGreenCorner([first,second,{...first,id:'green-125',drive:'rwd'}],selection).map(x=>x.id),['green-123','green-124']);
});
test('all AJES tables expand selected fuel, gearbox and drive into validated unions',()=>{
 for(const table of ['stats','china','korea'] as const){
  const sql=ajesQuery({table,fuel:selection.fuel,transmission:selection.transmission,drive:selection.drive}).sql;
  assert.match(sql,/time in \('P','D'\)/);assert.match(sql,/kpp in \('AT','CVT'\)/);if(table==='stats'){assert.match(sql,/grade like '%FWD%'/);assert.match(sql,/grade like '%4WD%'/);assert.doesNotMatch(sql,/priv in/);}else assert.match(sql,/priv in \('FF','FWD','4WD','AWD','FULLTIME4WD'\)/);
  assert.throws(()=>ajesQuery({table,fuel:"petrol|x' OR 1=1"}));
 }
 assert.throws(()=>ajesQuery({table:'china',transmission:'IAT'}),'source-specific Green code is not a normalized gearbox type');
 const filter=ajesResultFilter({bodyType:selection.bodyType});assert.equal(filter.matches(first),true);assert.equal(filter.matches(second),true);assert.equal(filter.matches({...first,bodyType:'coupe'}),false);
});
test('option lists retain separate selected values, scalar links and combined electric choices',()=>{
 assert.deepEqual(catalogFilterOptions([{value:'',label:'Любая'},{value:'automatic',label:'Автомат'},{value:'cvt',label:'Вариатор'}],[],selection.transmission).map(x=>x.value),['','automatic','cvt']);
 assert.equal(matchesFuelFilter('hybrid','petrol|electrified'),true);assert.equal(matchesFuelFilter('diesel','petrol|electrified'),false);
 assert.equal(isElectrifiedFilter('electric|hybrid'),true);assert.equal(isElectrifiedFilter('petrol|electric'),false);
 assert.equal(catalogSearchProjectionMatches(first,{transmission:'automatic'}),true);
});
