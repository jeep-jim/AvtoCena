import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {catalogFilterFacetsForClient} from '../apps/web/lib/catalog/filter-facets-wire';
test('ordinary catalog sends every consumed facet without the unused model directory',()=>{
 const facets={makes:['Nissan','Toyota'],models:Array.from({length:10000},(_,i)=>({make:'Nissan',model:'Model '+i,aliases:['Alias '+i]})),markets:['japan','china'],transmissions:['automatic','cvt'],drives:['fwd','awd'],fuels:['petrol'],bodyTypes:['hatchback']};
 const original=structuredClone(facets),wire=catalogFilterFacetsForClient(facets);
 assert.deepEqual(wire.models,[]);
 for(const key of ['makes','markets','transmissions','drives','fuels','bodyTypes'] as const)assert.strictEqual(wire[key],facets[key]);
 assert.deepEqual(facets,original,'server directory and all model rows must remain intact');
 assert.ok(Buffer.byteLength(JSON.stringify(wire))<Buffer.byteLength(JSON.stringify(facets))/100);
});
test('source-only models and aliases are preserved without truncation or reinterpretation',()=>{
 const facets={makes:['Nissan'],models:Array.from({length:250},(_,i)=>({make:'Nissan',model:'Note '+i,aliases:['Nissan Alias '+i]})),transmissions:['FAT','IAT']};
 assert.strictEqual(catalogFilterFacetsForClient(facets,true),facets);
 assert.strictEqual(catalogFilterFacetsForClient({models:[]}).models.length,0);
 const empty={makes:['Nissan']};assert.strictEqual(catalogFilterFacetsForClient(empty as typeof empty & {models?:unknown[]}),empty);
});
test('compaction is at the ordinary server-to-client boundary, never inside source pickers',()=>{
 const catalog=readFileSync('apps/web/components/catalog/CatalogContent.tsx','utf8');
 assert.match(catalog,/facets=\{catalogFilterFacetsForClient\(facets,initial\.stock==='green'\)\}/);
 const filters=readFileSync('apps/web/components/catalog/CatalogFilters.tsx','utf8');
 assert.match(filters,/sourceModels=auctionResults\|\|initial\.stock==="green"\?facets\?\.models:undefined/);
 for(const path of ['GreenCornerCatalog','AjesCatalog'])assert.doesNotMatch(readFileSync('apps/web/components/catalog/'+path+'.tsx','utf8'),/catalogFilterFacetsForClient/);
 const picker=readFileSync('apps/web/components/catalog/VehicleModelSearch.tsx','utf8');
 assert.match(picker,/if\(sourceOnly\|\|!contextual\|\|!open\|\|directory\)return/);
 assert.match(picker,/loadModelSuggestions\(\)/,'complete searchable directory is still loaded by the existing picker');
});
