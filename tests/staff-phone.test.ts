import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeStaffPhone} from '../apps/web/lib/staff-phone';
test('staff call numbers normalize local and international contacts safely',()=>{
 for(const input of ['8 (999) 123-45-67','+7 999 123 45 67','9991234567'])assert.equal(normalizeStaffPhone(input),'+79991234567');
 assert.equal(normalizeStaffPhone('+371 2123 4567'),'+37121234567');
 for(const input of ['', '123', 'javascript:alert(1)', '+79991234567;123', '+1234567890123456', '+0 1234567'])assert.equal(normalizeStaffPhone(input),'');
});
