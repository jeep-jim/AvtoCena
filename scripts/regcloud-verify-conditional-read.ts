import assert from 'node:assert/strict';
import {getJsonStorage,jsonReadByteLength} from '../apps/web/lib/data';
// Verify the real storage protocol before activating the new reader. No writes.
async function main(){
const storage=getJsonStorage();
const first=await storage.readJsonWithMeta('catalog/manifest.json',null);
assert.ok(first.found&&first.etag&&first.value,'catalog_manifest_missing');
const second=await storage.readJsonWithMeta('catalog/manifest.json',null,first);
assert.equal(second,first,'conditional_read_did_not_reuse_snapshot');
assert.ok((jsonReadByteLength(first.value)||0)>0,'read_byte_measurement_missing');
console.log('CONDITIONAL_READ_VERIFIED: unchanged manifest reused without downloading JSON');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
