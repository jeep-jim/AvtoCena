import test from 'node:test';
import assert from 'node:assert/strict';
import {monthDays,patternDates,shiftLabel} from '../apps/web/lib/crm-schedule-calendar';
test('calendar supports leap years, month boundaries and working day patterns',()=>{
 assert.equal(monthDays('2028-02').length,29);assert.equal(monthDays('2027-02').length,28);assert.equal(monthDays('2026-12').at(-1),'2026-12-31');
 assert.deepEqual(patternDates('2026-09','2/2','2026-09-25'),['2026-09-25','2026-09-26','2026-09-29','2026-09-30']);
 const work=patternDates('2026-09','weekdays','2026-09-01');assert.equal(work.length,22);assert.ok(!work.includes('2026-09-05'));assert.ok(work.includes('2026-09-28'));
 assert.equal(shiftLabel({start:'10:00',end:'20:00'}),'10:00–20:00');assert.equal(shiftLabel({start:'',end:''}),'Выходной');assert.equal(shiftLabel({kind:'note',start:'',end:'',note:'Встреча'}),'Отметка');
});
