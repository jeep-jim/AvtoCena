import test from 'node:test';
import assert from 'node:assert/strict';
import {readGroupedCatalogFacets} from '../apps/web/lib/catalog/market-facets';

test('grouped options use only bounded market reads with the same filters and merge duplicates',async()=>{
 const seen:string[]=[];let active=0,peak=0;
 const result=await readGroupedCatalogFacets({fuel:'electrified',city:'Новосибирск',sort:'totalRub'},['china','korea','japan'],async params=>{
  assert.equal(params.fuel,'electrified');assert.equal(params.city,'Новосибирск');assert.equal(params.sort,'totalRub');
  seen.push(params.market!);active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,2));active--;
  return {generationId:'g',makes:['Toyota',params.market!],models:[{make:'Toyota',model:'Corolla'}],markets:[params.market!],bodyTypes:['sedan'],fuels:['hybrid'],transmissions:['automatic'],drives:['fwd']};
 });
 assert.deepEqual(seen,['china','korea','japan']);assert.equal(peak,2);assert.equal(result.makes.length,4);assert.equal(result.models.length,1);assert.deepEqual(result.bodyTypes,['sedan']);
});
