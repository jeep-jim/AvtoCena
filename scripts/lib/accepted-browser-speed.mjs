import assert from 'node:assert/strict';
export const ACCEPTED_RELEASE='a182cd21b21ecf612b63613d263e5bdd817ea4c0';
const finite=(n)=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const requestCounts=(row)=>{
 assert.ok(Number.isInteger(row.requests)&&row.requests>=0&&Array.isArray(row.paths)&&row.paths.length===row.requests&&row.paths.every(path=>typeof path==='string'&&path.startsWith('/')),'missing or inconsistent request evidence');
 // The frozen capture has the same request-start interval as current reports.
 // Count query/preview work only: unrelated hover/account requests can begin
 // during this interval and are not caused by applying the selected budget.
 return {
  catalog:row.paths.filter(path=>path==='/cars'||/^\/cars\/china(?:\/|$)/.test(path)||path==='/api/catalog/search').length,
  previews:row.paths.filter(path=>path==='/api/catalog/saved-previews').length,
 };
};
export function acceptedBrowserSpeed(report,baseline){
 assert.equal(baseline.release,ACCEPTED_RELEASE,'wrong accepted browser baseline');
 assert.equal(baseline.passed,true,'baseline must be functionally verified');
 assert.equal(report.browserPassed,true,'browser functional checks must pass before speed acceptance');
 assert.ok(!report.error,'failed browser report cannot pass');
 const evidence=[],requestChecks=[];
 for(const width of [390,1280]){
  const prior=baseline.checks.filter(r=>r.width===width),current=report.checks.filter(r=>r.width===width);
  assert.equal(prior.length,1,'baseline width missing or duplicated');assert.equal(current.length,1,'browser width missing or duplicated');
  const a=prior[0],b=current[0];assert.deepEqual(b.pageErrors,[],'page errors block speed acceptance');
  const compare=(scenario,reference,seconds)=>{
   assert.ok(finite(reference)&&finite(seconds),'missing or invalid visible result timing');
   const allowance=Math.max(.05,reference*.05),ceiling=reference+allowance;
   evidence.push({width,scenario,referenceSeconds:reference,measurementNoiseSeconds:Number(allowance.toFixed(4)),ceilingSeconds:Number(ceiling.toFixed(4)),seconds,passed:seconds<=ceiling});
  };
  compare('firstCards',a.firstCardsSeconds,b.firstCardsSeconds);
  for(const budget of [1500000,2000000]){
   const old=a.filters.filter(r=>r.budget===budget),next=b.filters.filter(r=>r.budget===budget);
   assert.equal(old.length,1,'baseline budget missing or duplicated');assert.equal(next.length,1,'budget check missing or duplicated');
   const row=next[0];
   assert.ok(Number.isInteger(row.cards)&&row.cards>0&&row.pricedCards===row.cards,'every visible card needs a verified price');
   assert.ok(finite(row.largestPrice)&&row.largestPrice>0&&row.largestPrice<=budget,'visible card exceeds budget');
   compare('budget:'+budget,old[0].seconds,row.seconds);
   const priorRequests=requestCounts(old[0]),currentRequests=requestCounts(row);
   for(const kind of ['catalog','previews']){
    assert.ok(priorRequests[kind]>0,'baseline request measurement missing');
    requestChecks.push({width,budget,kind,ceilingRequests:priorRequests[kind],requests:currentRequests[kind],passed:currentRequests[kind]<=priorRequests[kind]});
   }
  }
 }
 return {baselineRelease:baseline.release,environment:baseline.environment,measurementAllowance:'50ms or 5% of the original sample, whichever is larger; no new baseline or discarded slow sample',passed:evidence.every(r=>r.passed)&&requestChecks.every(r=>r.passed),checks:evidence,requestChecks};
}
