import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import fs from 'node:fs/promises';
import path from 'node:path';
import {deriveReadPlan,exactProducerReadPlan,EXACT,EXACT_PARTIAL_SHA,verifyExactKnownPartial,verifiedLatestPartialChain,verifyLocalTerminalProof,buildLocalNativeIntake} from '../terminal-native-intake-local.mjs';
import {digest,guard as need,REV5,OLD_BASE,OLD,RELEASE,CALC} from '../rev5-successor-core.mjs';
import {exactV4PinRoles,exactV4SealedReadPlan,reconstructExactOldWithdrawalsOnly} from '../custody.mjs';
const H=/^[a-f0-9]{64}$/,G=1024**3,M=1024**2;
const sha=x=>createHash('sha256').update(x).digest('hex'),json=b=>JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(b));
const PIN='catalog/raw-feed-pins/v1/che168-intake-44765240609-1.json';
const CONTROL='catalog/independent-market-public-v1/china/control.json';
const READY='catalog/private-market-stage-v1/china/'+OLD.runId+'/READY.json';
const priorMeta=Object.freeze({producerRun:'44765240609',producerOperator:'891a5e3ed885872b99487a47b7d88edd172b1665',
 workerTree:'4dbbe41885deab5ab80002147aa04738d1048e67',controlSha256:REV5,controlRev:5,pinWireSha256:'a14bda5ccf4c4e8a3920ff8858d6bad6a8d5307fad0d706dd8236650a9b4f4d2',
 candidateManifestSha256:'e55a984351971929609780d2aa588215b78eb51c1debb4da07e13621481e9a0d',
 journalHeadSha256:'36c279e55fd61db002a85b7720fd32980124ce4d60ea08cb8f985d9f2359f9c2',
 pinAndHeadsRechecked:true,privateObjectScopeAuthenticated:true});
export const LINKED_PRODUCER=Object.freeze({runId:'44861718049',jobId:'136716356617',revision:'5d1087b3278546c82b70bb8407513fa2793733ee',
 workflow:'.github/workflows/china-v4-continuation-linked.yml',attempt:'1',
 ownerApprovalSha256:'7f8ce6d014ae4af618de554aa942a413d230f7264d92804b419baed0c0f9bb76',snapshotSha256:EXACT.snapshotSha256,
 protectedStepStartedAt:'2026-11-21T03:34:03Z',allowLinkedDetails:true,receiptClass:'completedPartial',
 officialReceiptSha256:'d01912d6f136d7cff43472280710cbcd460ddb2519f0edfe36653d5df6483319'});
const at=s=>Number.isFinite(Date.parse(s));
const limited=async(res,max,deadline)=>{
 need(res.status===200&&res.body,'authority_http');let parts=[],n=0;
 for await(const x of res.body){need((n+=x.length)<=max&&Date.now()<deadline,'authority_response_bound');parts.push(x);}
 return json(Buffer.concat(parts,n));
};
export async function authenticateCompletedSource(policy,{token,fetchImpl,expires}){
 need(policy&&/^[1-9][0-9]{0,19}$/.test(policy.runId)&&/^[1-9][0-9]{0,19}$/.test(policy.jobId)&&
  /^[a-f0-9]{40}$/.test(policy.revision)&&policy.attempt==='1'&&(
   (policy.receiptClass==='completedPartial'&&policy.runId===EXACT.runId&&policy.workflow===EXACT.workflow)||
   Object.entries(LINKED_PRODUCER).every(([k,v])=>policy[k]===v)||
   (policy.receiptClass==='completedSuccess'&&policy.runId==='44862697281'&&policy.jobId==='136719412770'&&
    policy.revision==='b77f7fba1141ee027107df3cf7028dcb52cd3d31'&&policy.ownerApprovalSha256==='0c521182d655b4ad6c9d2d2acf89748b07eb5241072258b7abe5c4ddea4dc99f'&&policy.workflow==='.github/workflows/china-v4-continuation-chain.yml'&&
    policy.protectedStepStartedAt==='2026-11-21T03:45:53Z'&&policy.protectedStepCompletedAt==='2026-11-21T04:08:38Z'&&
    policy.expectedChangeRequests===524&&policy.expectedLinkedOfferRequests===32&&policy.allowLinkedDetails===true))&&
  H.test(policy.ownerApprovalSha256)&&policy.snapshotSha256===EXACT.snapshotSha256&&at(policy.protectedStepStartedAt)&&
  ['completedPartial','completedSuccess'].includes(policy.receiptClass)&&H.test(policy.officialReceiptSha256),'source_producer_policy');
 const u='https://api.github.com/repos/jeep-jim/AvtoCena/actions/runs/'+policy.runId;
 const get=async suffix=>limited(await fetchImpl(u+suffix,{method:'GET',redirect:'error',
  headers:{authorization:'Bearer '+token,accept:'application/json','accept-encoding':'identity'},signal:AbortSignal.timeout(15000)}),M,expires);
 const [run,jobs]=await Promise.all([get(''),get('/attempts/1/jobs?per_page=100')]);
 const job=jobs?.jobs?.filter(x=>String(x.id)===policy.jobId),step=job?.[0]?.steps?.find(x=>x.name==='Capture exact private source continuation without publishing');
 need(run?.id===Number(policy.runId)&&run.run_attempt===1&&run.head_sha===policy.revision&&run.path===policy.workflow&&run.event==='push'&&
  run.head_branch==='main'&&run.repository?.id===1289722938&&run.status==='completed'&&run.conclusion==='success'&&jobs.total_count===jobs.jobs?.length&&
  job?.length===1&&String(job[0].run_id)===policy.runId&&job[0].head_sha===policy.revision&&job[0].conclusion==='success'&&
  step?.started_at===policy.protectedStepStartedAt&&step.conclusion==='success'&&at(step.completed_at)&&
  (policy.receiptClass==='completedPartial'||step.completed_at===policy.protectedStepCompletedAt),'source_producer_run_unverified');
 return {runId:policy.runId,jobId:policy.jobId,revision:policy.revision,workflow:policy.workflow,attempt:policy.attempt,
  stageStart:step.started_at,stageEnd:step.completed_at,[policy.receiptClass]:true,
  [policy.receiptClass==='completedPartial'?'partialSha256':'terminalSha256']:policy.officialReceiptSha256};
}
export async function materializeBoundSource({storage,scratch,scratchMeter,snapshotWire,producer,first,token,authorizeCurrentJob,readLiveControl,fetchImpl=globalThis.fetch,expires}){
 need(sha(snapshotWire)===EXACT.snapshotSha256&&first?.runId===EXACT.runId&&first?.officialReceiptSha256===EXACT_PARTIAL_SHA&&first.receiptClass==='completedPartial'&&
  producer?.receiptClass==='completedSuccess'&&BigInt(producer.runId)>BigInt(LINKED_PRODUCER.runId)&&expires>Date.now(),'exact_source_phase_plan');
 const check=()=>need(Date.now()<expires,'phase_deadline');
 let etag,rateAt=0,readCount=0,rawBytes=0;
 const allow=new Set([PIN,CONTROL,READY]), read=async(k,maximum)=>{
  check();need(allow.has(k)&&++readCount<=1200&&maximum>0&&maximum<=17*M,'bounded_key_authority');
  const v=await storage.getBinaryBounded(k,maximum);
  need(Buffer.isBuffer(v.data)&&v.data.length<=maximum&&(rawBytes+=v.data.length)<=2*G&&sha(v.data)===v.checksum,'bounded_signed_body');
  check();return v;
 };
 const permit=(...k)=>k.forEach(x=>allow.add(x));
 const assertLive=async(force=false)=>{
   check();
   if(force||Date.now()-rateAt>=60_000){
    await authorizeCurrentJob();
    const [ctl,health]=await Promise.all([readLiveControl(),fetchImpl('https://avtocena.com/api/health',{method:'GET',cache:'no-store',
     redirect:'error',signal:AbortSignal.timeout(10000)}).then(r=>limited(r,64*1024,expires))]);
    const o=ctl&&json(ctl.data);
    need(ctl?.checksum===REV5&&ctl?.etag&&(etag===undefined||etag===ctl.etag)&&digest(o.active)===OLD_BASE&&o.revision===5&&
     health?.releaseSha===RELEASE&&health.calculationVersion===CALC,'exact_live_rev5_or_22867_drift');
    etag=ctl.etag;rateAt=Date.now();
   }
 };
 await assertLive(true);
 const oldOfficial=await authenticateCompletedSource(first,{token,fetchImpl,expires});
 const middleOfficial=await authenticateCompletedSource(LINKED_PRODUCER,{token,fetchImpl,expires});
 const latestOfficial=await authenticateCompletedSource(producer,{token,fetchImpl,expires});
 const oldPlan=exactProducerReadPlan();permit(oldPlan.genesis,oldPlan.partial);
 const oldG=(await read(oldPlan.genesis,32*1024)).data,part=(await read(oldPlan.partial,32*1024)).data;
 const count=json(part)?.record?.durablePages;need(Number.isSafeInteger(count)&&count>0&&count<=256,'partial_page_count');
 const oldPages=[];for(let i=1;i<=count;i++){const k=oldPlan.page(i);permit(k);oldPages.push((await read(k,16*M)).data);}
 const priorPartial={official:oldOfficial,genesisWire:oldG,genesisWireSha:sha(oldG),partialWire:part,pageWires:oldPages};
 const firstProof=verifyExactKnownPartial(priorPartial).priorCheckpoint,oldGenesis=json(oldG).genesis;
 const secondOwner={repositoryId:'1289722938',runId:LINKED_PRODUCER.runId,attempt:'1',revision:LINKED_PRODUCER.revision,ownerApprovalSha256:LINKED_PRODUCER.ownerApprovalSha256};
 const secondG={...oldGenesis,continuationId:'verified-v4-che168-'+LINKED_PRODUCER.runId,newCollectionStartCursor:firstProof.resumeCursor,priorPrivateCheckpoint:firstProof};
 const secondPlan=deriveReadPlan({owner:secondOwner,genesis:secondG},LINKED_PRODUCER,firstProof);permit(secondPlan.genesis,secondPlan.partial);
 const secondGWire=(await read(secondPlan.genesis,32*1024)).data,secondWire=(await read(secondPlan.partial,32*1024)).data;
 const secondRec=json(secondWire)?.record;
 need(secondRec?.lastDurableCursor===13186101&&secondRec.durablePages===200&&secondRec.durableEvents===4000,'official_second_partial_census');
 const secondPages=[];for(let i=1;i<=secondRec.durablePages;i++){const k=secondPlan.page(i);permit(k);secondPages.push((await read(k,16*M)).data);}
 const priorPartials=[priorPartial,{official:middleOfficial,policy:LINKED_PRODUCER,reviewedPartialSha256:LINKED_PRODUCER.officialReceiptSha256,
  genesisWire:secondGWire,genesisWireSha:sha(secondGWire),partialWire:secondWire,pageWires:secondPages}];
 const prev=verifiedLatestPartialChain({priorPartials}).priorCheckpoint;
 need(prev.resumeCursor===13186101&&prev.events===5260,'all_prior_partial_pages_retained');
 const owner={repositoryId:'1289722938',runId:producer.runId,attempt:'1',revision:producer.revision,ownerApprovalSha256:producer.ownerApprovalSha256};
 const newG={...oldGenesis,continuationId:'verified-v4-che168-'+producer.runId,newCollectionStartCursor:prev.resumeCursor,priorPrivateCheckpoint:prev};
 const p=deriveReadPlan({owner,genesis:newG},producer,prev);permit(p.genesis,p.terminal,p.claim,p.ready);
 const [genesisWire,terminalWire,claimWire,readyWire]=await Promise.all([p.genesis,p.terminal,p.claim,p.ready].map(k=>read(k,32*1024).then(v=>v.data)));
 const target=json(terminalWire),privateRoot=json(claimWire)?.privateReplicaRoot;
 need(target?.sha256===producer.officialReceiptSha256&&digest(target.record)===target.sha256&&target.record.genesisSha256===p.genesisSha256&&
  H.test(target.record.persistedPageHeadSha256)&&/^catalog\/provider-replicas\/che168\/[a-f0-9-]{36}$/.test(privateRoot),'terminal_scoped_claim');
 const pages=[];let head=p.genesisSha256;
 while(head!==target.record.persistedPageHeadSha256){
  need(pages.length<producer.expectedChangeRequests-1,'bounded_terminal_page_sequence');
  const k=p.page(pages.length+1);permit(k);const b=(await read(k,16*M)).data,raw=json(b);
  need(raw.record?.genesisSha256===p.genesisSha256&&raw.record.previousHeadSha256===head&&H.test(raw.sha256)&&digest(raw.record)===raw.sha256,'exact_sequential_page_head');
  pages.push(b);head=raw.sha256;
 }
 const [pin0,oldReady]=await Promise.all([read(PIN,32*1024),read(READY,32*1024)]);
 need(oldReady.checksum===OLD.readySha256,'live_incumbent_ready');
 const roles=exactV4PinRoles(pin0.data),m=roles.candidateRoot+'/manifest.json',j=roles.journalRoot+'/head.json',base=roles.previous.key+'/manifest.json',fresh=privateRoot+'/manifest.json';permit(m,j,base,fresh);
 const [candidateManifestWire,journalHeadWire,acceptedManifest,manifestWire]=await Promise.all([m,j,base,fresh].map(k=>read(k,512*1024).then(v=>v.data)));
 need(digest(json(acceptedManifest))===roles.previous.sha256,'exact_prior_base_manifest');
 const inp={pinWire:pin0.data,candidateManifestWire,journalHeadWire,attested:priorMeta},v4=exactV4SealedReadPlan(inp);
 for(const d of v4.journal.chunks)permit(roles.journalRoot+'/'+d.id+'.json');
 const old=await reconstructExactOldWithdrawalsOnly({...inp,readLocalJournalChunk:async id=>(await read(roles.journalRoot+'/'+id+'.json',17*M)).data});
 const parameters={official:latestOfficial,genesisWire,terminalWire,claimWire,readyWire,pageWires:pages,oldLedgerWire:old.privateByteWire,
  configWire:snapshotWire,manifestWire,priorPartials,approvedPins:{genesisWire:sha(genesisWire),claimWire:sha(claimWire),readyWire:sha(readyWire)},now:Date.now()};
 const verified=verifyLocalTerminalProof(parameters,producer);
 const file=path.join(scratch,'fresh-private-replica.sqlite'),f=await fs.open(file,'wx',0o600);
 try{
  let parts=0;
  for(const ref of verified.parts){
   const k=privateRoot+'/'+parts+'.gz';permit(k);const b=gunzipSync((await read(k,17*M)).data,{maxOutputLength:16*M});
   need(b.length===ref.bytes&&sha(b)===ref.sha256,'immutable_replica_uncompressed_part');
   await f.writeFile(b);
   if(++parts%30===0){await scratchMeter.check('restore_terminal_sqlite');await assertLive();}
  }
  await f.sync();
 }finally{await f.close();}
 await assertLive(true);
 const outputRoot=path.join(scratch,'native-local-intake');
 const result=await buildLocalNativeIntake({...parameters,nativeReplicaFile:file,outputRoot,acceptedBase:{
  provenFromExactRev5:true,controlSha256:REV5,activeRefSha256:OLD_BASE,cursor:13123821,replica:old.acceptedBaseNativeDescriptor,
 },assertAuthenticatedReadonlyAuthority:()=>assertLive(true),scratchMeter},producer);
 return {result,outputRoot,assertLive,roots:{originalJournal:roles.journalRoot,snapshot:'catalog/provider-snapshots/che168/'+roles.binding,
  oldReplica:old.acceptedBaseNativeDescriptor,newReplica:verified.replicaDescriptor,priorJournal:oldPlan.root,priorJournal2:secondPlan.root,journal:p.root},readCount,rawBytes};
}
