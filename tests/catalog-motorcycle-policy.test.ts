import test from 'node:test';
import assert from 'node:assert/strict';
import {motorcycleExcluded,motorcycleSqlExclusion} from '../apps/web/lib/catalog/motorcycle-policy';
import {catalogVehicleExcluded} from '../apps/web/lib/catalog/inventory-admission';
import {isRenderablePublicCatalogOffer} from '../apps/web/lib/catalog/offer-quality';
test('motorcycles cannot bypass admission through retained seller projections',()=>{
 for(const row of [{make:'YAMAHA',model:'OTHER',trim:'Star -400'},{make:'YAMAHA',model:'OTHER',trim:'GT'},{make:'Honda',bodyType:'motorcycle'},{make:'BMW',vehicleCategory:'L3e'},{make:'Suzuki',model:'мотоцикл'}]){
  assert.equal(motorcycleExcluded(row),true);assert.equal(catalogVehicleExcluded(row),true);
  assert.equal(isRenderablePublicCatalogOffer({...row,cardProjectionVersion:3,catalogPricingMode:'seller'}),false);
 }
 assert.match(motorcycleSqlExclusion(),/YAMAHA/);
 for(const row of [{make:'Honda',model:'Fit'},{make:'Suzuki',model:'Jimny'},{make:'BMW',model:'M3'},{make:'KTM',model:'X-Bow'},{make:'Piaggio',model:'Porter',bodyType:'van'}])assert.equal(motorcycleExcluded(row),false);
});
