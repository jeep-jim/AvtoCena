// Offline, exact prior-run receipt validation. No network, writes, or credentials.
// Usage: node verify-44863525814-checkpoint.mjs RECEIPT TAIL_BODY TAIL_ATTEMPT ORIGINAL_ANCHOR
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const sha=b=>createHash('sha256').update(b).digest('hex');
const digest=o=>sha(JSON.stringify(o));
const assert=(v,c)=>{if(!v)throw Error(c);};
export function verifyExactPhase4(wire){
const [r,tail,attempt,original]=wire.map(b=>JSON.parse(b));
assert(wire.every((b,i)=>sha(b)===digest([r,tail,attempt,original][i])),'encar_exact_private_wire_format');
assert(r.identity?.runId==='44863525814'&&r.identity.attempt==='1'&&r.identity.revision==='175413fda63f02cce3ecce7b2ed5e769487db736'
 &&r.phase==='phase4'&&r.pages===1583&&r.attempts===1584&&r.rows===31660&&r.duplicateRows===1&&r.hold===null
 &&r.nextPage===1584&&r.originalRunId==='44863525814'&&r.continueAllowed===false
 &&r.ownerHash==='e0c565ead963fc9b6ce6f82859f7372819a583fd52f2e2609fee146b1c6a230f'
 &&r.approvalSha256==='19c31d08801abba811134e095bf9add0c61b5e2b32276d495419eb2e913cb351'
 &&r.originalAnchorSha256==='6a96d6c226f0da849f0cece3aadde95008189fa1c6b70aa63ec759021af98c6c','encar_exact_phase4_identity');
assert(r.successorEligible===true&&r.kind==='scoped_working_checkpoint'&&r.depth===0
 &&r.archivedWholeInventory===false&&r.reconciledChanges===false&&r.publicationAllowed===false&&r.cursorAdvanced===false
 &&r.scope?.market==='korea'&&r.scope?.API==='encar_v3'&&r.scope?.year_from===2022&&r.scope?.for_sale===1
 &&Number.isSafeInteger(r.anchor?.id)&&r.anchor.id>=0&&r.anchor.date==='2026-11-21'
 &&typeof r.anchor.receivedAt==='string'&&r.anchor.receivedAt.slice(0,10)===r.anchor.date
 &&Number.isFinite(Date.parse(r.anchor.receivedAt))&&/^[0-9a-f]{64}$/.test(r.chain||''),'encar_exact_phase4_source_scope');
const p={runId:r.identity.runId,revision:r.identity.revision,phase:r.phase,receiptSha256:digest(r),chain:r.chain,nextPage:r.nextPage,
 originalRunId:r.originalRunId,originalAnchor:r.anchor,originalAnchorSha256:r.originalAnchorSha256,priorDepth:r.depth};
assert(p.receiptSha256===sha(wire[0])&&digest(tail)===p.chain&&tail.index===1584
 &&digest(attempt)===digest({index:tail.index,previous:tail.previous,request:tail.request})
 &&digest(tail.request)===digest({endpoint:'offers',params:{page:1583,year_from:2022,for_sale:1}}),'encar_exact_phase4_tail');
const last=JSON.parse(Buffer.from(tail.wire,'base64').toString('utf8'));
assert(last.meta?.page===1583&&last.meta.next_page===1584,'encar_exact_phase4_next');
assert(digest(original)===p.originalAnchorSha256&&original.index===1
 &&digest(original.request)===digest({endpoint:'change_id',params:{date:p.originalAnchor.date}})
 &&original.receivedAt===p.originalAnchor.receivedAt
 &&JSON.parse(Buffer.from(original.wire,'base64').toString('utf8')).change_id===p.originalAnchor.id,'encar_exact_phase4_anchor');
return p;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==6)throw Error('encar_exact_phase4_requires_four_authenticated_objects');
 const wire=await Promise.all(process.argv.slice(2).map(p=>fs.readFile(p)));
 const p=verifyExactPhase4(wire);
 console.log(JSON.stringify({kind:'verified_phase4_predecessor_metadata',predecessor:p,providerTerminal:false,publish:false},null,2));
}
