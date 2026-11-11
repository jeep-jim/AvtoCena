import test from 'node:test';
import assert from 'node:assert/strict';
import {auctionSaleRange,auctionSaleDateLabel} from '../apps/web/lib/catalog/auction-sale-period';
import {ajesQuery,ajesCatalogQuery} from '../apps/web/lib/catalog/ajes-query';
import {selectionQuery} from '../apps/web/lib/dealers/selection-share';
test('auction periods use local dates, calendar months and union boundaries',()=>{
 const now=new Date('2026-10-21T20:00:00Z');
 assert.deepEqual(auctionSaleRange('week',now),{from:'2026-10-16',toExclusive:'2026-10-23'});
 assert.deepEqual(auctionSaleRange('week|month|3months',now),{from:'2026-07-22',toExclusive:'2026-10-23'});
 assert.equal(auctionSaleRange('month',new Date('2026-03-31T00:00:00Z'))?.from,'2026-02-28');
 assert.throws(()=>auctionSaleRange("month' OR 1=1"));
});
test('provider list and count receive the same sale-date condition and shares retain it',()=>{
 const q=ajesCatalogQuery({market:'japan',salePeriod:'week|2months'});
 const range=auctionSaleRange('week|2months')!;
 for(const aggregate of [undefined,'count','makes'] as const){const sql=ajesQuery({...q,aggregate}).sql;assert.ok(sql.includes(`auction_date>='${range.from}'`));assert.ok(sql.includes(`auction_date<'${range.toExclusive}'`));}
 assert.equal(ajesCatalogQuery({market:'china',salePeriod:'week'}).salePeriod,undefined);
 assert.throws(()=>ajesQuery({table:'stats',salePeriod:"' OR 1=1"}));
 assert.equal(selectionQuery(new URLSearchParams({market:'japan',salePeriod:'week|month'})).get('salePeriod'),'week|month');
});
test('sale date display preserves supplier date and never fabricates missing values',()=>{
 assert.equal(auctionSaleDateLabel('2026-10-15 00:00:00'),'15.10.2026');
 for(const value of [null,'','0000-00-00','2026-02-31'])assert.equal(auctionSaleDateLabel(value),'');
});
test('auction sale sorting works in both directions before pagination',()=>{
 for(const [sort,direction] of [['auctionDateAsc','asc'],['auctionDateDesc','desc']]){
  const sql=ajesQuery(ajesCatalogQuery({market:'japan',sort,salePeriod:'month'})).sql;
  assert.match(sql,new RegExp(`order by auction_date ${direction}, id asc limit`));
 }
});
