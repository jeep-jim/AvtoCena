import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

// Original owner-accepted captures. Add coverage separately; never regenerate
// these hashes from candidate measurements or a replacement baseline.
export const FROZEN_SPEED_BASELINES=Object.freeze({
 '2026-11-11-accepted-speed-baseline.json':'32fba449b77e40983803483ea7b6cb4ece09afa997c2ae08dd968c675f528c59',
 '2026-11-11-accepted-browser-speed-baseline.json':'1ad263a9f9c6c4d656ffec4aca51d2b96f5fd284afb759e96ae53cee2bf39b06',
});

export function verifyFrozenSpeedBaselines(root=process.cwd()){
 for(const [name,expected] of Object.entries(FROZEN_SPEED_BASELINES)){
  const actual=createHash('sha256').update(readFileSync(join(root,'docs/operations',name))).digest('hex');
  assert.equal(actual,expected,`frozen_speed_baseline_changed:${name}`);
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 verifyFrozenSpeedBaselines();
 console.log('Original server and browser speed baseline hashes verified');
}
