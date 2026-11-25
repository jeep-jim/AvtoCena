import test from 'node:test';
import assert from 'node:assert/strict';
import {isPreparedChinaDetailCity,detailCityStoragePolicy} from '../apps/web/lib/catalog/prepared-china-detail-city';

test('catalog URL city stays authoritative only for a prepared China detail', () => {
  assert.equal(isPreparedChinaDetailCity(true,'china','Новокузнецк'),true);
  assert.equal(isPreparedChinaDetailCity(true,'china','Москва'),true);
  assert.equal(isPreparedChinaDetailCity(true,'china',''),false);
  assert.equal(isPreparedChinaDetailCity(true,'korea','Новокузнецк'),false);
  assert.equal(isPreparedChinaDetailCity(false,'china','Новокузнецк'),false);
});

test('pinned China price must not be silently repriced from global city storage', () => {
  for(const localCitySelection of [true,false]) {
    for(const canSave of [true,false]) {
      const policy = detailCityStoragePolicy({pinnedPreparedCity:true,localCitySelection,canSave,localCityEdited:false});
      assert.deepEqual(policy,{syncStored:false,syncStoredOnMount:false,persistSelection:false});
      assert.equal(detailCityStoragePolicy({pinnedPreparedCity:true,localCitySelection,canSave,localCityEdited:true}).syncStored,false);
    }
  }
});

test('unrelated catalogue details keep their previous selected-city behavior',()=>{
  assert.deepEqual(detailCityStoragePolicy({}),{syncStored:true,syncStoredOnMount:true,persistSelection:true});
  assert.deepEqual(detailCityStoragePolicy({localCitySelection:true}),
    {syncStored:true,syncStoredOnMount:true,persistSelection:false});
  assert.deepEqual(detailCityStoragePolicy({localCitySelection:true,localCityEdited:true}),
    {syncStored:false,syncStoredOnMount:true,persistSelection:false});
  assert.deepEqual(detailCityStoragePolicy({initialScenario:true}),
    {syncStored:false,syncStoredOnMount:false,persistSelection:false});
});
