import assert from 'node:assert/strict';
// A diagnostic may record a slow result; acceptance must reject it using raw timings.
export function assertInteractionAcceptance(rows, expectedRelease) {
  assert.deepEqual(rows.map(row=>row.width).sort((a,b)=>a-b),[390,1440], 'both mobile and desktop must be measured exactly once');
  for (const row of rows) {
    assert.equal(row.release,expectedRelease,'measurements belong to the installed release');
    for (const action of ['category','filter']) {
      const ms=row[`${action}Ms`];
      assert.ok(Number.isFinite(ms)&&ms>=0&&ms<=2000,`${row.width}px ${action}: ${ms}ms exceeds 2000ms or is invalid`);
    }
    assert.ok(Number.isInteger(row.cards)&&row.cards>0,'correct nonempty cards required');
    assert.ok(row.feedback?.samples>0,'actual pending state required');
    assert.equal(row.feedback.emptyCards,false,'retain cards while pending');
    assert.equal(row.feedback.headerVisible,false,'no header loader during filter');
    assert.deepEqual(row.errors,[],'no page errors');
  }
}
