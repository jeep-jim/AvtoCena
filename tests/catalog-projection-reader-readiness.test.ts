import test from 'node:test';
import assert from 'node:assert/strict';
import {assertScopedProjectionReaderReady} from '../scripts/lib/catalog-projection-reader-readiness.mjs';

test('scoped publication refuses legacy/unhealthy readers before changing storage', async()=>{
  const releaseSha='a'.repeat(40);
  for(const health of [{ok:true,releaseSha},{ok:false,releaseSha,catalogProjectionParts:'scoped-v1'},{ok:true,releaseSha:'',catalogProjectionParts:'scoped-v1'}])
    await assert.rejects(assertScopedProjectionReaderReady(async()=>({ok:true,json:async()=>health})),/not_installed/);
  await assert.rejects(assertScopedProjectionReaderReady(async()=>({ok:false})),/health_failed/);
  assert.deepEqual(await assertScopedProjectionReaderReady(async(url)=>{
    assert.equal(url,'https://avtocena.com/api/health');
    return {ok:true,json:async()=>({ok:true,releaseSha,catalogProjectionParts:'scoped-v1'})};
  }),{releaseSha,format:'scoped-v1'});
});
