export function catalogStorageBudget(currentBytes,inputBytes) {
 if (![currentBytes,inputBytes].every(n=>Number.isSafeInteger(n)&&n>=0))throw Error('Invalid storage inventory size');
 const estimatedAdditionalBytes=Math.max(1_000_000_000,inputBytes*8);
 const limitBytes=50_000_000_000,headroomBytes=5_000_000_000;
 return {currentBytes,inputBytes,estimatedAdditionalBytes,headroomBytes,limitBytes,
  ok:currentBytes+estimatedAdditionalBytes+headroomBytes<limitBytes};
}

export function recentHealthyStorageMaintenance(report, now, minimumIntervalMs, currentBytes) {
 const age=now-Date.parse(report?.checkedAt||'');
 return Number.isSafeInteger(currentBytes) && currentBytes>=0 && currentBytes<35_000_000_000
   && report?.ok===true && Number.isFinite(age) && age>=0 && age<minimumIntervalMs
   && Number.isSafeInteger(report.afterBytes) && report.afterBytes>=0 && report.afterBytes<35_000_000_000;
}
