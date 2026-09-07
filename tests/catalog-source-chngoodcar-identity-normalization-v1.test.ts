import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeGoodCarBrandModelIdentity } from '../apps/web/lib/catalog/chngoodcar-paginated-exact-source';

test('Good Car identity removes only the duplicated 汽车 token after exact make normalization', () => {
  assert.deepEqual(normalizeGoodCarBrandModelIdentity('吉利', '汽车 星越 2019款 300T 探星者'), { make: '吉利', model: '星越' });
  assert.deepEqual(normalizeGoodCarBrandModelIdentity('大众', '汽车T-ROC探歌'), { make: '大众', model: 'T-ROC探歌' });
  assert.deepEqual(normalizeGoodCarBrandModelIdentity('现代汽车', '伊兰特'), { make: '现代', model: '伊兰特' });
  assert.deepEqual(normalizeGoodCarBrandModelIdentity('马自达', 'CX-30 2022款 2.0L 自动嘉悦型'), { make: '马自达', model: 'CX-30' });
});
