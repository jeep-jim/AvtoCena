import test from 'node:test';
import assert from 'node:assert/strict';
import {findSavedAjesSearch} from '../apps/web/lib/catalog/ajes-saved-search';
import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';
import {compileModelFacts,checksum,type CalculationIndex} from '../apps/web/lib/encyclopedia/calculation-index';
const now=Date.now();
function snapshot(id:string,patch:Record<string,unknown>={}){
 return {observedAt:new Date(now).toISOString(),items:[{id,table:'stats',make:'HONDA',model:'CR-V',year:2013,status:'Sold',finalPriceJpy:500000,auctionDate:'2026-10-24',chassisCode:'DBA-RE4',sourceDrive:'',trim:'',...patch}]};
}
test('saved Japan drive search uses local chassis proof before page slicing with no supplier drive',()=>{
 const snapshots={first:snapshot('01',{chassisCode:'RE3'}),unknown:snapshot('02',{chassisCode:'UNKNOWN'}),match:snapshot('03'),next:snapshot('04')};
 const result=findSavedAjesSearch({make:'Honda',drive:'awd',pageSize:1},snapshots,now)!;
 assert.deepEqual(result.items.map(l=>l.id),['03']);
 assert.equal(result.partial,true);assert.equal(result.stale,true);assert.equal('total' in result,false);
 assert.equal(findSavedAjesSearch({make:'Porsche',drive:'awd'},snapshots,now),null);
 assert.equal(findSavedAjesSearch({drive:'awd',page:2},snapshots,now),null);
 assert.equal(findSavedAjesSearch({drive:'awd',fuel:'diesel'},snapshots,now),null);
 assert.equal(findSavedAjesSearch({drive:'awd'},{expired:{...snapshot('old'),observedAt:new Date(now-8*86400000).toISOString()}},now),null);
});
test('shared or conflicting chassis stay unknown; source and explicit grade retain their precedence',()=>{
 const snapshots={shared:snapshot('01',{make:'SUZUKI',model:'ALTO',chassisCode:'HA36S'}),two:snapshot('02',{trim:'2WD'}),conflict:snapshot('03',{trim:'AWD FWD'}),source:snapshot('04',{sourceDrive:'FF'}),explicit:snapshot('05',{chassisCode:'UNKNOWN',trim:'L 4WD'}),known:snapshot('06')};
 assert.deepEqual(findSavedAjesSearch({drive:'awd'},snapshots,now)!.items.map(l=>l.id),['05','06']);
 assert.deepEqual(findSavedAjesSearch({drive:'fwd'},snapshots,now)!.items.map(l=>l.id),['04']);
});
test('saved model family selection and verified annual index use the same drivetrain resolution',()=>{
 const models={x:compileModelFacts({id:'m',make:'Suzuki',model:'Alto Lapin',revision:'r',variants:[{id:'v',trim:'L',year:2023,status:'observed',chassisCode:'HA37S',drive:'fwd',markets:['china']}]})};
 const index:CalculationIndex={version:1,digest:checksum(models),manifestDigest:'m',createdAt:'now',models};
 const snapshots={one:snapshot('01',{make:'SUZUKI',model:'ALTO LAPIN',year:2023,chassisCode:'HA37S'}),other:snapshot('02',{make:'SUZUKI',model:'ALTOX',year:2023,chassisCode:'HA37S'})};
 const q={make:'Suzuki',model:'Alto',modelFamilies:'Alto',drive:'fwd'};
 assert.deepEqual(findSavedAjesSearch(q,snapshots,now,index)!.items.map(l=>l.id),['01']);
 assert.equal(findSavedAjesSearch(q,snapshots,now),null);
});
test('client returns labelled saved drive matches after refusal without retries or clearing cooldown',async()=>{
 let requests=0;
 const snapshots={one:snapshot('01')};
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},fetcher:async()=>{requests++;return new Response('ban2 fixture');},readSavedSearch:async q=>findSavedAjesSearch(q,snapshots,now)});
 const result=await client.read({make:'Honda',drive:'awd'},'127.0.0.1');
 assert.deepEqual(result.items.map((l:any)=>l.id),['01']);assert.equal(result.partial,true);assert.equal(result.stale,true);
 await assert.rejects(()=>client.read({make:'Porsche',drive:'awd'},'127.0.0.1'),/visitor_restricted/);
 assert.equal(requests,1);
});
