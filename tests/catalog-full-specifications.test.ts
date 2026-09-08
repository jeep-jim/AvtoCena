import test from 'node:test';
import assert from 'node:assert/strict';
import { retainNamedSpecificationGroups } from '../apps/web/lib/catalog/source-specifications';
import { vehicleResearchUrl } from '../apps/web/lib/catalog/vehicle-research-link';

test('technical snapshot keeps units, duplicate contradictory values, empty, zero and false without stringifying objects', () => {
  const groups = retainNamedSpecificationGroups([{ name:'Engine', paramitems:[
    {name:'Displacement (mL)',value:'1485'}, {name:'Displacement (L)',value:'1.5'},
    {name:'Power (Ps)',value:'99'}, {name:'Power (Ps)',value:'100'},
    {name:'Unknown',value:''}, {name:'Distance',value:0}, {name:'Optional',value:false},
    {name:'nested',value:{ sellerPhone:'not a technical scalar' }},
  ]}]);
  assert.equal(groups[0].items.length, 7);
  assert.deepEqual(groups[0].items.slice(2,4).map(row => row.value), ['99','100']);
  assert.deepEqual(groups[0].items.slice(4).map(row => row.value), ['', '0','false']);
  assert.deepEqual(retainNamedSpecificationGroups({seller:{name:'example'}}), []);
});

test('research link includes market and exact trim but never suggests an answer or forwards URL parameters', () => {
  const identity = {make:'DAIHATSU',model:'ATRAI WAGON',trim:'CUSTOM TURBO R',year:2010,chassisCode:'S321G',market:'japan', powerHp:150,vin:'SECRET'};
  const url = new URL(vehicleResearchUrl(identity)!);
  assert.equal(url.origin, 'https://yandex.ru');
  const query = url.searchParams.get('text')!;
  for (const value of ['DAIHATSU','ATRAI WAGON','CUSTOM TURBO R','2010','S321G','Японии']) assert.ok(query.includes(value));
  assert.ok(!query.includes('150'));
  assert.ok(!query.includes('SECRET'));
  assert.equal(vehicleResearchUrl({make:'Daihatsu'}),null);
  const special = new URL(vehicleResearchUrl({make:'A&B',model:'X?text=inject#fragment'})!);
  assert.equal([...special.searchParams].length,1);
  assert.equal(special.hash,'');
});

test('electric and series hybrid lookup asks for continuous power rather than peak power', () => {
  for (const powertrainKind of ['electric','series_hybrid']) {
    assert.ok(new URL(vehicleResearchUrl({make:'Test',model:'Model',powertrainKind})!).searchParams.get('text')!.includes('30-минутная'));
  }
});
