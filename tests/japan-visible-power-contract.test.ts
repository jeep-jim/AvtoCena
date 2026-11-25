import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ajesResultFilter} from '../apps/web/lib/catalog/ajes-result-filter';
import {japanPowerSearchHint} from '../apps/web/lib/catalog/japan-source-power';
import {reviewedJapanPower} from '../apps/web/lib/catalog/japan-reviewed-power';

const base={
  id:'ajes-stats-fixture1',market:'japan',sourceId:'ajes_japan_feed',
  make:'Toyota',model:'Corolla',year:2021,engineCc:1798,fuel:'petrol',
  operational:{raw:{sourcePower:'150'}},
};
const fact=(id:string,powerHp:number,overrides:Record<string,unknown>={})=>({
 id,make:'Toyota',model:'Corolla',yearFrom:2020,yearTo:2022,
 engineCc:1798,engineCcTolerance:20,powerHp,confidence:'manufacturer',
 sourceIds:['manufacturer:factory-sheet'],verifiedAt:'2026-11-20T12:00:00Z',...overrides
});
test('reviewed manufacturer power requires Japan exact make/model/year/engine and rejects ambiguity',()=>{
 const a=fact('a',140);
 assert.deepEqual(reviewedJapanPower(base as any,[a] as any),{powerHp:140,referenceId:'a'});
 assert.equal(reviewedJapanPower({...base,engineCc:1500} as any,[a] as any),null);
 assert.equal(reviewedJapanPower({...base,year:2018} as any,[a] as any),null);
 assert.equal(reviewedJapanPower({...base,model:'Corolla Cross'} as any,[a] as any),null);
 assert.equal(reviewedJapanPower({...base,market:'china'} as any,[a] as any),null);
 assert.equal(reviewedJapanPower({...base,powerHp:180} as any,[a] as any),null);
 assert.equal(reviewedJapanPower(base as any,[a,fact('b',170)] as any),null);
 assert.equal(reviewedJapanPower(base as any,[fact('c',140,{confidence:'source_consensus'})] as any),null);
 assert.equal(reviewedJapanPower(base as any,[fact('d',140,{engineCc:undefined})] as any),null);
 assert.equal(reviewedJapanPower(base as any,[fact('e',140,{yearFrom:undefined,yearTo:undefined})] as any),null);
});
test('Japan <=160 first uses documented horsepower, then safely marked conventional source hint',()=>{
 const filter=ajesResultFilter({market:'japan',powerTo:'160'});
 assert.equal(filter.matchesPower({...base,powerHp:145}),true);
 assert.equal(filter.matchesPower({...base,powerHp:181}),false);
 assert.equal(filter.matchesPower({...base,powerHp:181,operational:{raw:{sourcePower:'100'}}}),false);
 assert.equal(filter.matchesPower(base),true);
 assert.equal(filter.matchesPower({...base,operational:{raw:{sourcePower:'150,180'}}}),false);
 assert.equal(filter.matchesPower({...base,operational:{raw:{sourcePower:'150'}} ,fuel:'hybrid'}),false);
 assert.equal(filter.matchesPower({...base,operational:{raw:{sourcePower:'140'}} ,fuel:'electric'}),false);
 assert.equal(filter.matchesPower({...base,operational:{raw:{sourcePower:'n/a'}}}),false);
 assert.equal(japanPowerSearchHint(base)?.requiresConfirmation,true);
 assert.equal('powerHp' in base,false);
});
test('configured Japan rail persists through an empty/slow supplier response',()=>{
 const rail=readFileSync('apps/web/components/catalog/AjesRail.tsx','utf8');
 const home=readFileSync('apps/web/app/(public)/page.tsx','utf8');
 const catalog=readFileSync('apps/web/components/catalog/CatalogContent.tsx','utf8');
 assert.match(rail,/if\(disabled\)return null/);
 assert.doesNotMatch(rail,/if\(disabled\|\|\(!unavailable&&!items\.length/);
 assert.match(rail,/export function AjesRailPending/);
 assert.match(home,/japanAuctions=\{<Suspense fallback=\{<AjesRailPending\/>\}/);
 assert.match(catalog,/fallback=\{<AjesRailPending\/>\}/);
 assert.match(rail,/это не означает, что машин в Японии нет/);
});
test('supplier-wide count is never misrepresented as power-filter result',()=>{
 const aj=readFileSync('apps/web/components/catalog/AjesCatalog.tsx','utf8');
 const rail=readFileSync('apps/web/components/catalog/AjesRail.tsx','utf8');
 assert.match(aj,/const sourceTotal=powerSelected\?null:/);
 assert.match(aj,/Показано \$\{result\?\.items\.length\?\?0\} · всего уточняется/);
 assert.match(aj,/Предварительные значения не используются для расчёта утильсбора/);
 assert.match(aj,/!result\.powerIncomplete&&<p/);
 const endpoint=readFileSync('apps/web/app/(public)/api/catalog/search/route.ts','utf8');
 const reader=readFileSync('apps/web/lib/catalog/ajes-catalog.ts','utf8');
 assert.match(endpoint,/countOnly/);
 assert.match(endpoint,/powerIncomplete:true/);
 assert.match(reader,/unverifiedPowerSeen/);
 assert.match(reader,/params\.powerFrom\|\|params\.powerTo/);
 assert.match(rail,/powerSelected\?<MarketResultCount>/);
});
