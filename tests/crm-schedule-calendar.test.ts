import test from 'node:test';
import assert from 'node:assert/strict';
import {monthDays,patternDates,shiftLabel} from '../apps/web/lib/crm-schedule-calendar';
test('calendar supports leap years, month boundaries and working day patterns',()=>{
 assert.equal(monthDays('2028-02').length,29);assert.equal(monthDays('2027-02').length,28);assert.equal(monthDays('2026-12').at(-1),'2026-12-31');
 assert.deepEqual(patternDates('2026-09','2/2','2026-09-25'),['2026-09-25','2026-09-26','2026-09-29','2026-09-30']);
 const work=patternDates('2026-09','weekdays','2026-09-01');assert.equal(work.length,22);assert.ok(!work.includes('2026-09-05'));assert.ok(work.includes('2026-09-28'));
 assert.equal(shiftLabel({start:'10:00',end:'20:00'}),'10:00–20:00');assert.equal(shiftLabel({start:'',end:''}),'Выходной');assert.equal(shiftLabel({kind:'note',start:'',end:'',note:'Встреча'}),'Отметка');
});

test('explicit cycle includes work and rest, continues across months and defaults to today',async()=>{
 const {schedulePattern,defaultScheduleStart}=await import('../apps/web/lib/crm-schedule-calendar');
 assert.equal(defaultScheduleStart('2026-09','2026-09-28'),'2026-09-28');assert.equal(defaultScheduleStart('2026-10','2026-09-28'),'2026-10-01');
 const pattern={from:'2026-09-28',to:'2026-09-30',anchor:'2026-09-28',workDays:2,restDays:2,mode:'cycle' as const};
 assert.deepEqual(schedulePattern(pattern).map(d=>d.kind),['work','work','off']);
 assert.deepEqual(schedulePattern({...pattern,from:'2026-10-01',to:'2026-10-04'}).map(d=>d.kind),['off','work','work','off']);
 assert.deepEqual(schedulePattern({...pattern,from:'2026-09-26',to:'2026-09-29'}).map(d=>d.kind),['off','off','work','work']);
 assert.equal(schedulePattern({...pattern,workDays:0}).length,0);assert.equal(schedulePattern({...pattern,to:'2026-10-01'}).length,0);
 assert.deepEqual(schedulePattern({...pattern,from:'2026-10-02',to:'2026-10-05',mode:'weekdays'}).map(d=>d.kind),['work','off','off','work']);
 const custom=schedulePattern({...pattern,from:'2026-10-01',to:'2026-10-12',anchor:'2026-10-01',workDays:3,restDays:3});assert.equal(custom.filter(d=>d.kind==='work').length,6);assert.equal(custom.filter(d=>d.kind==='off').length,6);
});
