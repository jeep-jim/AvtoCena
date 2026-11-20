import { verifyNativeInput } from './combined.mjs';
// Intentionally never calls execute(), even on successful native validation.
await verifyNativeInput(process.argv[2]);
console.log(JSON.stringify({exactPrivateNativeInput:true,count:1510,providerCalls:0,storageWrites:0,readyToActivate:false}));
