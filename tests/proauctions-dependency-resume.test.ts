import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {collectionEnabled,defaultCollectionControls} from '../apps/web/lib/catalog/collection-controls-schema';
import {recoveryDecision} from '../scripts/lib/catalog-recovery-policy.mjs';
test('retired auction collector has no executable entry point or recovery dispatch',()=>{
 assert.equal(existsSync('scripts/collect-proauctions.mjs'),false);
 assert.equal(existsSync('.github/workflows/proauctions-collect-publish.yml'),false);
 const controls=defaultCollectionControls();
 controls.sources.proauctions_japan_stat={enabled:true,enabledAt:null,disabledAt:null,changedBy:null};
 assert.equal(collectionEnabled(controls,'proauctions_japan_stat'),false);
 assert.deepEqual(recoveryDecision({market:'japan',runs:[],japan:{complete:false}}),{action:'none',reason:'market_withdrawn'});
});
