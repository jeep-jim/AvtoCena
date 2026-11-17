import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';const sha=x=>createHash('sha256').update(x).digest('hex');
/** All libraries used by initial publisher and actual serving runtime must agree.
 * A budget child on correct source does not fix old initial catalog pricing. */
export function assertDerivedPricingRuntime({publisherRoot,runtimeRoot,expectedRelease}){
 assert.ok(runtimeRoot&&/^[a-f0-9]{40}$/.test(expectedRelease||''),'derived_runtime_required');
 const git=(root,args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']});
 assert.equal(git(runtimeRoot,['rev-parse','HEAD']).trim(),expectedRelease);assert.equal(git(runtimeRoot,['diff','--name-only','HEAD']).trim(),'');assert.equal(git(publisherRoot,['diff','--name-only','HEAD']).trim(),'');
 const closure=root=>git(root,['ls-tree','-rz','--full-tree','HEAD','--','apps/web/lib','packages']).split('\0').filter(Boolean).sort();
 const a=closure(publisherRoot),b=closure(runtimeRoot);assert.ok(a.length>100,'derived_pricing_closure_missing');assert.deepEqual(a,b,'derived_publisher_serving_library_mismatch');return sha(JSON.stringify(a));
}
