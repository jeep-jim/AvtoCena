import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const mobile='mobile_de_open', scout='autoscout_europe_open';
const nativeScope='europe_native_compact_source_group';
const whitespace=c=>c===' '||c==='\r'||c==='\n'||c==='\t';
const req=(x,code)=>assert.ok(x,code);
const hash=()=>createHash('sha256');
const cap=128*1024**2, maxRowBytes=1024**2, maxDepth=96;

// Recognize only native JSON {generationId,items} order/shape. No compressed
// modes, chunks, fallback, multiple top-level values or field projection API.
export async function streamNativeMembership(body,{wireBytes,generation,rowCount,deadline=Infinity,clock=Date.now}){
 req(Number.isSafeInteger(wireBytes)&&wireBytes>0&&wireBytes<=cap,'wire_size_bound');
 req(/^gen_\d{1,20}_[a-z0-9-]{1,64}$/.test(generation)&&Number.isSafeInteger(rowCount)&&rowCount>0&&rowCount<=40000,'generation_or_row_bound');
 const decoder=new TextDecoder('utf-8',{fatal:true});
 const ids=new Set(), groups=new Map();
 const whole=hash();
 let n=0, state='header', header='', partial='', depth=0, literal=false, backslash=false;
 function admit(text){
   req(Buffer.byteLength(text)<=maxRowBytes,'inline_row_size');
   let x;try{x=JSON.parse(text);}catch{throw Error('inline_row_json');}
   req(x?.market==='europe'&&typeof x.sourceGroup==='string'&&/^[a-z0-9_-]{1,72}$/.test(x.sourceGroup)&&
      typeof x.id==='string'&&x.id.length>0&&x.id.length<=128&&!ids.has(x.id)&&ids.size<rowCount,'duplicate_or_unbound_inline_row');
   ids.add(x.id);
   // No arbitrary source labels printed. Preserve extra source groups inside one
   // ordered digest so a later comparator also guards that complement.
   const group=x.sourceGroup===mobile?mobile:x.sourceGroup===scout?scout:'other_protected';
   if(!groups.has(group))groups.set(group,{id:hash(),row:hash(),count:0});
   const record=groups.get(group);
   record.count++;
   record.id.update(JSON.stringify(group==='other_protected'?[x.sourceGroup,x.id]:x.id)+'\n');
   record.row.update(JSON.stringify(x)+'\n');
 }
 function feed(text){
   let from=state==='row'?0:-1;
   for (let index=0;index<text.length;index++){
     const c=text[index];
     if(state==='row'){
       if(literal){
         if(backslash)backslash=false;
         else if(c==='\\')backslash=true;
         else if(c==='"')literal=false;
       }else if(c==='"')literal=true;
       else if(c==='{'||c==='['){req(++depth<=maxDepth,'inline_row_depth');}
       else if(c==='}'||c===']'){
         if(--depth===0){
           req(c==='}','inline_row_close');
           req(partial.length+index+1-from<=maxRowBytes,'inline_row_size');
           admit(partial+text.slice(from,index+1));
           partial='';state='separator';from=-1;
         }
       }
       continue;
     }
     if(state==='header'){
       header+=c;
       req(header.length<=512,'inline_header_bound');
       if(c==='['){
         const m=header.match(/^\s*\{\s*"generationId"\s*:\s*"(gen_\d{1,20}_[a-z0-9-]{1,64})"\s*,\s*"items"\s*:\s*\[$/);
         req(m?.[1]===generation,'not_exact_native_inline_root');
         state='item';
       }
       continue;
     }
     if(whitespace(c))continue;
     if(state==='item'){
       req(c==='{','inline_item_expected');
       depth=1;state='row';from=index;literal=false;backslash=false;
     }else if(state==='separator'){
       req(c===','||c===']','inline_separator_expected');
       state=c===','?'item':'tail';
     }else if(state==='tail'){
       req(c==='}','inline_tail_expected');state='done';
     }else throw Error('inline_trailing_value');
   }
   if(state==='row'){
     req(from>=0&&partial.length+text.length-from<=maxRowBytes,'inline_row_size');
     partial+=text.slice(from);
   }
 }
 for await(const block of body){
   req(clock()<deadline&&ArrayBuffer.isView(block)&&block.byteLength>0,'inline_stream_budget');
   n+=block.byteLength;req(n<=wireBytes&&n<=cap,'inline_wire_overflow');
   whole.update(block);feed(decoder.decode(block,{stream:true}));
 }
 feed(decoder.decode());
 req(clock()<deadline&&n===wireBytes&&state==='done'&&ids.size===rowCount,'inline_incomplete');
 req(groups.get(mobile)?.count>0&&groups.get(scout)?.count>0,'expected_source_pair_missing');
 return {scope:nativeScope,format:'native_inline_only',generation,count:ids.size,
   groups:Object.fromEntries([...groups].sort(([a],[b])=>a.localeCompare(b)).map(([id,rec])=>[id,
      {count:rec.count,orderedIdsSha:rec.id.digest('hex'),orderedProjectionRowsSha:rec.row.digest('hex')} ])),
   wireBytes:n,wireSha256:whole.digest('hex'),rawOfferChunksRead:0,fullPublicCardPayloadPreservationProven:false};
}
