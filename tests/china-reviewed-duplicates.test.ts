import test from 'node:test';
import assert from 'node:assert/strict';
import {isReviewedSourceDuplicate} from '../apps/web/lib/catalog/reviewed-source-duplicates';
import {deduplicatePublicCatalogOffers} from '../apps/web/lib/catalog/public-offer-deduplication';
import {matchingBudgetIndex} from '../apps/web/lib/catalog/budget-count-index';
import {projectionCanRenderCard,catalogSearchProjectionMatches} from '../apps/web/lib/catalog/storage';
const canonical='39c1b3d1260fdf7f0948e795';
const aliases=['48361d3deeccac1d8612ae42','079eac8d7d05d7c53f2be510'];
const distinct=['7b9eab94a5ce453dd42f64d0','6cd56bd5ed6df56a99624939','184ea9867c33ca2b4095419f','06fcd029497476db3dbb82a7'];
test('only reviewed duplicate ads are excluded; distinct colours and model configurations survive',()=>{
 for(const id of aliases){assert.ok(isReviewedSourceDuplicate({market:'china',id}));assert.equal(isReviewedSourceDuplicate({market:'japan',id}),false);}
 for(const id of [canonical,...distinct])assert.equal(isReviewedSourceDuplicate({market:'china',id}),false);
 const rows=[canonical,...aliases,...distinct].map(id=>({id,market:'china',sourceId:'autohome_used_china_open',images:[]} as any));
 const result=deduplicatePublicCatalogOffers(rows);
 assert.deepEqual(result.rows.map(x=>x.id),[canonical,...distinct]);
 assert.deepEqual(result.removed.map(x=>x.keptId),[canonical,canonical]);
});
test('existing projection and budget indexes omit aliases before pagination and counting',()=>{
 for(const id of aliases){const row={id,market:'china'} as any;assert.equal(projectionCanRenderCard(row),false);assert.equal(catalogSearchProjectionMatches(row,{market:'china'}),false);}
 const index={version:1,generationId:'old',sourceRows:7,rows:[canonical,...aliases,...distinct].map(id=>['china',1500000,null,null,false,{id}])} as any;
 assert.deepEqual(matchingBudgetIndex(index,{market:'china',budgetTo:2000000}).map(x=>x[5].id),[canonical,...distinct]);
});
