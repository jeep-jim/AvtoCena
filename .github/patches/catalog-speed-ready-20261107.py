from pathlib import Path

def replace_once(path, before, after):
    p=Path(path);s=p.read_text()
    assert s.count(before)==1, path+' anchor mismatch'
    p.write_text(s.replace(before,after))

client='apps/web/lib/catalog/ajes-client.ts'
replace_once(client,'  // Only exact, already requested list responses are inspected here.','  // Inspect exact already requested lists and metadata, never detail responses.')
replace_once(client,'  // for two unrelated supplier requests. No new shared TTL or feed crawl.','  // for two unrelated supplier requests. Names/counts have the same existing\n  // observation deadline. No new shared TTL, source admission or feed crawl.')
replace_once(client,"return value?.schemaVersion===2&&!value.stale&&!value.partial&&age>=0&&age<30*60*1000;","const supported=value?.schemaVersion===2||Array.isArray(value?.makes)||Array.isArray(value?.models)||Array.isArray(value?.colors)||Number.isSafeInteger(value?.total);\n    return supported&&!value.stale&&!value.partial&&age>=0&&age<30*60*1000;")
replace_once(client,"""      const inMemory=query.kind==='list'?cache.peekFresh(query.sql):undefined;
      if(inMemory!==undefined)return inMemory;
      const inspectPrepared=query.kind==='list';""","""      // Complete Korea details still follow the original provenance-preserving path.
      const inspectPrepared=query.kind!=='detail';
      const inMemory=inspectPrepared?cache.peekFresh(query.sql):undefined;
      if(inMemory!==undefined)return inMemory;
      // Reuse only this visitor's already recovered result while the original
      // refusal cooldown is active. Looking it up after queue/storage work made
      // the 30-second recovery cache ineffective at protecting repeat visits.
      // peekFresh never renews its deadline; a new shared success above wins.
      const recovered=inspectPrepared?visitorCache.peekFresh(visitorKey):undefined;
      if(recovered?.stale&&isUsable(recovered)
        &&(cooling(quotaKey)||cooling('visitor:'+clientIp)||cooling(visitorKey))){
        await deps.assertEnabled(query.table);
        return recovered;
      }""")
replace_once(client,"""            let saved:any=null;try{saved=await deps.readQuery?.(query.sql);}catch{}
            if(isUsable(saved)){await deps.assertEnabled(query.table);return {...saved,stale:true};}""","""            const saved=prepared;
            if(isUsable(saved)){await deps.assertEnabled(query.table);return {...saved,stale:true};}""")
replace_once('apps/web/components/catalog/CatalogContent.tsx',"import {readMarketSection}","import {catalogFilterFacetsForClient} from '@/lib/catalog/filter-facets-wire';\nimport {readMarketSection}")
replace_once('apps/web/components/catalog/CatalogContent.tsx','initial={initial} facets={facets} resultCount={countIncomplete?undefined:total}',"initial={initial} facets={catalogFilterFacetsForClient(facets,initial.stock==='green')} resultCount={countIncomplete?undefined:total}")
files={
'apps/web/lib/catalog/filter-facets-wire.ts':r'''/**
 * The ordinary catalog picker loads its complete model directory on opening.
 * Its server facets.models array is not consumed by CatalogFilters, so shipping
 * that second directory in every page/navigation response is unnecessary.
 * Source-only/auction pickers retain their model rows and all other facets stay
 * unchanged. This is a transport projection, never an inventory/data mutation.
 */
export function catalogFilterFacetsForClient<T extends {models?: unknown[]}>(facets:T,usesSourceModels=false):T {
  return usesSourceModels || !facets.models?.length ? facets : {...facets,models:[]};
}
''',
 'tests/ajes-ready-metadata.test.ts':r'''import test from 'node:test';
import assert from 'node:assert/strict';
import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';
import {ajesQuery} from '../apps/web/lib/catalog/ajes-query';
const tick=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
const ip='203.0.113.10';
const snapshot=(aggregate:string,at=Date.now())=>({items:[],page:1,pageSize:aggregate==='count'?1:500,received:1,rejected:0,observedAt:new Date(at).toISOString(),stale:false,
 ...(aggregate==='makes'?{makes:[{make:'KIA',total:24}]}:aggregate==='models'?{models:[{make:'KIA',model:'SELTOS',total:24}]}:aggregate==='colors'?{colors:[{color:'WHITE',total:24}]}:{total:24})});
for(const aggregate of ['makes','models','colors','count'] as const)test(`ready ${aggregate} never waits for the occupied supplier queue`,async()=>{
 let release!:()=>void,started=0,reads=0,done=false;const held=new Promise<void>(r=>release=r);
 const sql=ajesQuery({table:'korea',aggregate}).sql;
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},readQuery:async key=>{reads++;return key===sql?snapshot(aggregate):null;},fetcher:async()=>{started++;await held;return Response.json([]);}});
 const busy=[1,2].map(page=>client.read({table:'korea',page},ip));
 try{
  for(let i=0;i<100&&started<2;i++)await tick();assert.equal(started,2);
  const ready=client.read({table:'korea',aggregate},'203.0.113.11').then(v=>{done=true;return v;});
  for(let i=0;i<100&&!done;i++)await tick();
  assert.equal(done,true,'stored metadata must be independent of external supplier admission');
  assert.equal((await ready).stale,false);assert.equal(started,2);
  const before=reads;await client.read({table:'korea',aggregate},'203.0.113.12');assert.equal(reads,before,'reuse must not read storage again');
 }finally{release();await Promise.allSettled(busy);}
});
for(const aggregate of ['makes','models','colors','count'] as const)test(`${aggregate} preparation retains the observation deadline and source checks`,async t=>{
 let now=Date.parse('2026-11-07T12:00:00Z'),requests=0,disabled=false; t.mock.method(Date,'now',()=>now);
 const saved=snapshot(aggregate,now-29*60000);
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{if(disabled)throw Error('owner_disabled');},reserve:async()=>{},readQuery:async()=>saved,fetcher:async()=>{requests++;return Response.json(aggregate==='count'?[{total:25}]:[]);}});
 assert.equal((await client.read({table:'korea',aggregate},ip)).observedAt,saved.observedAt);assert.equal(requests,0);
 disabled=true;await assert.rejects(client.read({table:'korea',aggregate},ip),/owner_disabled/);disabled=false;
 now+=2*60000;await client.read({table:'korea',aggregate},ip);assert.equal(requests,1,'memoization must not renew the 30-minute observation window');
});
test('same-visitor recovery during cooldown does no new storage or supplier work and remains stale',async t=>{
 let now=Date.parse('2026-11-07T12:00:00Z'),reads=0,requests=0,disabled=false,password='fixture';t.mock.method(Date,'now',()=>now);
 const saved=snapshot('makes',now-3600000);
 const client=createAjesClient({password:()=>password,assertEnabled:async()=>{if(disabled)throw Error('owner_disabled');},reserve:async()=>{},readQuery:async()=>{reads++;return saved;},fetcher:async()=>{requests++;return new Response('ban2 fixture');}});
 const query={table:'korea' as const,aggregate:'makes' as const};
 const first=await client.read(query,ip);assert.equal(first.stale,true);const initialReads=reads;
 for(let i=0;i<3;i++){now+=5000;const value=await client.read(query,ip);assert.equal(value.stale,true);assert.equal(value.observedAt,saved.observedAt);}
 assert.equal(reads,initialReads);assert.equal(requests,1);
 disabled=true;await assert.rejects(client.read(query,ip),/owner_disabled/);disabled=false;
 password='';await assert.rejects(client.read(query,ip),/not_configured/);password='fixture';
 await assert.rejects(client.read(query,''),/client_ip_missing/);
 await client.read(query,'203.0.113.99');assert.equal(requests,2,'another visitor must not inherit refusal or recovered data');
 const before=reads;now+=16000;await client.read(query,ip);assert.ok(reads>before,'reads never slide the existing 30-second recovery deadline');assert.equal(requests,2,'active visitor cooldown still prohibits source retries');
});
test('new shared success wins over an older visitor-specific recovery',async()=>{
 const saved=snapshot('makes',Date.now()-3600000);let calls=0;
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},readQuery:async()=>saved,fetcher:async()=>++calls===1?new Response('ban2 fixture'):Response.json([{MARKA_NAME:'HYUNDAI',TAG1:'10'}])});
 const q={table:'korea' as const,aggregate:'makes' as const};
 assert.equal((await client.read(q,ip)).stale,true);
 assert.equal((await client.read(q,'203.0.113.99')).stale,false);
 const next=await client.read(q,ip);assert.equal(next.stale,false);assert.equal(next.makes[0].make,'HYUNDAI');assert.equal(calls,2);
});
test('prepared metadata never promotes partial, stale, future, wrong-page or malformed data',async()=>{
 for(const patch of [{partial:true},{stale:true},{observedAt:new Date(Date.now()+60000).toISOString()},{page:2},{pageSize:1},{makes:null}]){
  let calls=0;const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},readQuery:async()=>({...snapshot('makes'),...patch}),fetcher:async()=>{calls++;return Response.json([{MARKA_NAME:'KIA',TAG1:'24'}]);}});
  const value=await client.read({table:'korea',aggregate:'makes'},ip);assert.equal(calls,1,JSON.stringify(patch));assert.equal(value.stale,false);
 }
});
''',
 'tests/catalog-filter-facets-wire.test.ts':r'''import test from 'node:test';
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
'''
}
for path,content in files.items():
    p=Path(path);assert not p.exists(),path+' already exists';p.write_text(content)
print('Applied two bounded speed changes; no source, pricing, inventory or dealer layout changes.')
