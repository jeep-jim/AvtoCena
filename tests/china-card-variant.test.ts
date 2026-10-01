import test from 'node:test';
import assert from 'node:assert/strict';
import {chinaCardVariant,isChinaModelSpecification} from '../apps/web/lib/catalog/china-card-variant';
test('AutoHome model configurations retain seats, engine, fuel and trim in distinct Russian labels',()=>{
 const offer={market:'china',sourceGroup:'autohome_new_china_open'};
 assert.ok(isChinaModelSpecification(offer));
 assert.ok(isChinaModelSpecification({market:'china',catalogEntryKind:'model_variant'}));
 assert.equal(isChinaModelSpecification({market:'china',sourceGroup:'autohome_used_china_open'}),false);
 const a=chinaCardVariant({...offer,trim:'2026款 1.6L 舒适型 2座厢车'});
 const b=chinaCardVariant({...offer,trim:'2026款 1.6L 舒适型 5座厢车'});
 assert.equal(a,'1.6L Комфорт 2 места фургон');assert.equal(b,'1.6L Комфорт 5 мест фургон');assert.notEqual(a,b);
 assert.match(chinaCardVariant({...offer,trim:'2026款 1.6L CNG 豪华型 5座厢车'}),/CNG Люкс 5 мест/);
 assert.equal(chinaCardVariant({market:'china',trim:'2026 1.5L CVT Luxury'}),'1.5L CVT Luxury');
 assert.equal(chinaCardVariant({market:'japan',trim:'2026 something'}),'');
});
