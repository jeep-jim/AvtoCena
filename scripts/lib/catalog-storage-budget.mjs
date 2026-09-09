export function catalogStorageBudget(currentBytes,inputBytes) {
 if (![currentBytes,inputBytes].every(n=>Number.isSafeInteger(n)&&n>=0))throw Error('Invalid storage inventory size');
 const estimatedAdditionalBytes=Math.max(1_000_000_000,inputBytes*8);
 const limitBytes=50_000_000_000,headroomBytes=5_000_000_000;
 return {currentBytes,inputBytes,estimatedAdditionalBytes,headroomBytes,limitBytes,
  ok:currentBytes+estimatedAdditionalBytes+headroomBytes<limitBytes};
}
