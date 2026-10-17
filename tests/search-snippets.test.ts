import assert from 'node:assert/strict';
import test from 'node:test';
import {catalogSearchMetadata,SEARCH_MARKETS,WEBSITE_SCHEMA} from '../apps/web/lib/catalog/search-metadata';
test('six country listings have distinct descriptions and stable canonical addresses',()=>{
 const descriptions=new Set();for(const [market,country] of Object.entries(SEARCH_MARKETS)){const m=catalogSearchMetadata({market});assert.ok(String(m.title).includes(country));descriptions.add(m.description);assert.equal(m.alternates?.canonical,`/cars/${market}`);assert.equal((m.robots as any).index,true);}assert.equal(descriptions.size,6);
 assert.equal(catalogSearchMetadata({market:'japan',utm_source:'yandex',yclid:'123'}).alternates?.canonical,'/cars/japan');
});
test('pagination remains distinct, custom filters and company previews are not indexed',()=>{
 assert.equal(catalogSearchMetadata({market:'japan',page:'2'}).alternates?.canonical,'/cars/japan?page=2');
 assert.equal(catalogSearchMetadata({market:'japan',page:'Infinity'}).alternates?.canonical,'/cars/japan');
 assert.equal(catalogSearchMetadata({market:'japan',make:'Toyota',model:'Corolla'}).alternates?.canonical,'/cars/japan/Toyota/Corolla');
 for(const p of [{dealer:'example'},{preview:'1'},{budget:'1000000'},{market:'constructor'},{market:'unknown'}])assert.equal((catalogSearchMetadata(p).robots as any).index,false);
 assert.equal(WEBSITE_SCHEMA.name,'АвтоЦена');assert.equal(WEBSITE_SCHEMA.url,'https://avtocena.com/');
});
