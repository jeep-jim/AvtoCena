import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {runChinaFullFreshOneShot} from '../scripts/catalog-china-full-fresh-one-shot.mjs';

test('one-shot rejects an authenticated-shaped staging launch without separately approved Regcloud scope before credential or archive access',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'china-one-shot-authorization-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const sha=b=>createHash('sha256').update(b).digest('hex'),a='a'.repeat(64),head='b'.repeat(40);
 const workflow='.github/workflows/china-full-fresh-prepare-v1.yml';
 const launcherSha256=sha(await fs.readFile(new URL('../scripts/catalog-china-full-fresh-one-shot.mjs',import.meta.url)));
 const plan={version:1,repository:'jeep-jim/AvtoCena',workflow,job:'prepare',jobDisplayName:'Prepare full fresh China with one frozen quote',
  launcherSha256,authorizesPublication:false,sourceMode:'complete-fresh-replacement',canonicalPolicy:'native-public-identity-and-renderable-single-source-v1',
  authorizedHeadSha:head,archiveReportSha256:a,archiveManifestSha256:a,ownerApprovalSha256:a,collectorClosureSha256:a,calculationVersion:a,
  generationId:'gen_1790000000000_fixture',blockRows:50,modelScope:{make:'BMW',model:'X3'},privateStage:{authorized:false,expectedChinaPublicBaseSha256:a}};
 const bytes=Buffer.from(JSON.stringify(plan)),file=path.join(dir,'launch.json');
 await fs.writeFile(file,bytes,{mode:0o600});
 const nonexistent=path.join(dir,'not-created');
 const flags=['--launch',file,'--expect-launch-sha',sha(bytes),'--guard-bundle',nonexistent,'--native-root',nonexistent,
  '--receipt',nonexistent,'--source-secrets',nonexistent,'--stage-secrets',nonexistent,'--scratch',nonexistent,'--runtime-context',nonexistent];
 const env={GITHUB_SHA:head,GITHUB_REPOSITORY:plan.repository,GITHUB_REF:'refs/heads/main',GITHUB_JOB:'prepare',
  GITHUB_RUN_ATTEMPT:'1',GITHUB_WORKFLOW_REF:plan.repository+'/'+workflow+'@refs/heads/main',GITHUB_RUN_ID:'9'};
 await assert.rejects(runChinaFullFreshOneShot(flags,env),/separate_regcloud_private_stage_authority_required/);
 await assert.rejects(runChinaFullFreshOneShot(flags,{...env,GITHUB_SHA:'f'.repeat(40)}),/launch_contract/);
 assert.deepEqual(await fs.readdir(dir),['launch.json']);
});

test('approved one-shot bucket privacy denial precedes archive, FX and all storage writes',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'china-one-shot-privacy-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const sha=b=>createHash('sha256').update(b).digest('hex'),a='a'.repeat(64),head='b'.repeat(40);
 const workflow='.github/workflows/china-full-fresh-prepare-v1.yml';
 const launcherSha256=sha(await fs.readFile(new URL('../scripts/catalog-china-full-fresh-one-shot.mjs',import.meta.url)));
 const guardEntryPrefix='verified/b/c/stage/';
 const guardFiles=[];
 for(const item of ['guarded-capsule-runner.mjs','prepare-native-archive.mjs','bounded-archive-restore.mjs','bind-converted-continuity.mjs',
  'read-current-china-proof.mjs','clean-snapshot-admission.mjs','authenticate-fresh-fx-owner.mjs','fresh-fx-run-authority.mjs','prepare-fresh-replacement-proof.mjs',
  '../candidate-final/producer/operational/upstream/flow/input/SOURCE_PINS.json','../../../budget-fallback/china-heavy-policy.mjs']){
  const file=path.posix.normalize(guardEntryPrefix+item),full=path.join(dir,file),data=Buffer.from('not-actually-run\n');
  await fs.mkdir(path.dirname(full),{recursive:true});await fs.writeFile(full,data);
  guardFiles.push({file,bytes:data.length,sha256:sha(data)});
 }
 const runtimeCodeFiles=[];
 for(const file of ['apps/web/lib/catalog/prepared-china-fresh-price-replay.ts','apps/web/lib/catalog/china-durable-object-stage.ts','scripts/lib/china-shadow-disk.mjs',
  'apps/web/lib/catalog/independent-china-prepared-fixture.ts','apps/web/lib/catalog/prepared-price-card-block.ts','apps/web/lib/data.ts','apps/web/lib/catalog/china-private-stage-privacy.ts']){
  const data=await fs.readFile(new URL('../'+file,import.meta.url));runtimeCodeFiles.push({file,bytes:data.length,sha256:sha(data)});
 }
 const storage={endpoint:'https://s3.regru.cloud',bucket:'avtocena-staging-8120751',prefix:'migration-staging/full-20261011',region:'us-east-1'};
 const plan={version:1,repository:'jeep-jim/AvtoCena',workflow,job:'prepare',jobDisplayName:'Prepare full fresh China with one frozen quote',
  launcherSha256,authorizesPublication:false,sourceMode:'complete-fresh-replacement',canonicalPolicy:'native-public-identity-and-renderable-single-source-v1',
  authorizedHeadSha:head,archiveReportSha256:a,archiveManifestSha256:a,ownerApprovalSha256:a,collectorClosureSha256:a,calculationVersion:a,
  generationId:'gen_1790000000000_fixture',blockRows:50,modelScope:{make:'BMW',model:'X3'},guardEntryPrefix,guardFiles,runtimeCodeFiles,
  privateStage:{authorized:true,expectedChinaPublicBaseSha256:a,storage,minAdmittedRows:1,maxArtifactBytes:1024}};
 const bytes=Buffer.from(JSON.stringify(plan)),file=path.join(dir,'launch.json'),secret=path.join(dir,'secret.json');
 await fs.writeFile(file,bytes,{mode:0o600});await fs.writeFile(secret,JSON.stringify({access:'probe-test-stage',secret:'local-fixture-only'}),{mode:0o600});
 const nonexistent=path.join(dir,'not-created');
 const flags=['--launch',file,'--expect-launch-sha',sha(bytes),'--guard-bundle',dir,'--native-root',dir,
  '--receipt',nonexistent,'--source-secrets',secret,'--stage-secrets',secret,'--scratch',dir,'--runtime-context',nonexistent];
 const env={GITHUB_SHA:head,GITHUB_REPOSITORY:plan.repository,GITHUB_REF:'refs/heads/main',GITHUB_JOB:'prepare',
  GITHUB_RUN_ATTEMPT:'1',GITHUB_WORKFLOW_REF:plan.repository+'/'+workflow+'@refs/heads/main',GITHUB_RUN_ID:'9'};
 const requests=[],fetchBefore=globalThis.fetch;t.after(()=>{globalThis.fetch=fetchBefore;});
 globalThis.fetch=async(u,opts)=>{requests.push([String(u),opts.method,opts.redirect]);
  assert.match(new Headers(opts.headers).get('authorization'),/^AWS4-HMAC-SHA256 Credential=probe-test-stage\//);
  return new Response('<Error><Code>AccessDenied</Code></Error>',{status:403});
 };
 await assert.rejects(runChinaFullFreshOneShot(flags,env),/china_private_stage_privacy:bucket_acl_unverified:403/);
 assert.deepEqual(requests,[['https://s3.regru.cloud/avtocena-staging-8120751?acl=','GET','error']]);
});
