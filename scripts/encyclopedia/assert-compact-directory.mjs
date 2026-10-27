import {getJsonStorage} from '../../apps/web/lib/data.ts';
import {MANIFEST} from '../../apps/web/lib/encyclopedia/records.ts';
const manifest=await getJsonStorage().readJson(MANIFEST,null);
const models=manifest?.models?.filter(m=>m.directorySnapshot)||[];
if(!manifest?.directoryCapturedAt||!models.length||models.some(m=>!m.compact||!m.directorySnapshot.capturedAt||!Number.isSafeInteger(m.directorySnapshot.count)||m.directorySnapshot.count<0))throw Error('compact_directory_not_ready');
console.log(JSON.stringify({compactDirectoryReady:true,models:models.length,capturedAt:manifest.directoryCapturedAt}));
