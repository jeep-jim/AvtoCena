import assert from 'node:assert/strict';
// Owner decision 28.10.2026: correctness blocks acceptance; speed is reported separately.
export function assertInteractionAcceptance(rows, expectedRelease) {
  const slowActions=[];
  assert.deepEqual(rows.map(row=>row.width).sort((a,b)=>a-b),[390,1440], 'both mobile and desktop must be measured exactly once');
  for (const row of rows) {
    assert.equal(row.release,expectedRelease,'measurements belong to the installed release');
    for (const action of ['category','filter']) {
      const ms=row[`${action}Ms`];
      assert.ok(Number.isFinite(ms)&&ms>=0,`${row.width}px ${action}: invalid timing ${ms}`);
      if(ms>2000)slowActions.push({width:row.width,action,ms,targetMs:2000});
    }
    assert.ok(Number.isInteger(row.cards)&&row.cards>0,'correct nonempty cards required');
    assert.ok(row.feedback?.samples>0,'actual pending state required');
    assert.equal(row.feedback.emptyCards,false,'retain cards while pending');
    assert.equal(row.feedback.headerVisible,false,'no header loader during filter');
    assert.deepEqual(row.errors,[],'no page errors');
  }
  return {functionalPassed:true,performanceAccepted:slowActions.length===0,slowActions};
}
