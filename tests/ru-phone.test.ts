import assert from 'node:assert/strict';
import {test} from 'node:test';
import {normalizeRuPhone, phoneNational} from '../apps/web/lib/ru-phone';
test('phone variants normalize to one number; incomplete and overlong submissions fail', () => {
  for(const value of ['9991234567','89991234567','+7 (999) 123-45-67']) {
    assert.equal(normalizeRuPhone(value), '+79991234567');
    assert.equal(phoneNational(value), '9991234567');
  }
  for(const value of ['+7','999123456','799912345678','123456789012345']) assert.equal(normalizeRuPhone(value),'');
  assert.equal(phoneNational('999123456789'), '9991234567');
});
