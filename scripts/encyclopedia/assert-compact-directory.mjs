import {setTimeout as delay} from 'node:timers/promises';
import {getJsonStorage} from '../../apps/web/lib/data.ts';
import {MANIFEST} from '../../apps/web/lib/encyclopedia/records.ts';
// Release-triggered dependency wait only; never a recurring collector.
const deadline=Date.now()+(process.argv.includes('--wait')?30*60*1000:0);
let manifest;
for(;;){
 manifest=await getJsonStorage().readJson(MANIFEST,null);
 if(manifest?.directoryCapturedAt)break;
 if(Date.now()>=deadline)throw Error('compact_directory_not_ready');
 console.log(JSON.stringify({waitingForCompactDirectory:true}));
 await delay(30000);
}
const models=manifest.models?.filter(m=>m.directorySnapshot)||[];
if(!models.length||models.some(m=>!m.compact||!m.directorySnapshot.capturedAt||!Number.isSafeInteger(m.directorySnapshot.count)||m.directorySnapshot.count<0))throw Error('compact_directory_invalid');
console.log(JSON.stringify({compactDirectoryReady:true,models:models.length,capturedAt:manifest.directoryCapturedAt}));
