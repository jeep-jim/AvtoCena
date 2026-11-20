import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {createChe168MissingDetails} from './exact-missing-details.mjs';
const sourceId='autohome_used_china_open', SHA=/^[a-f0-9]{64}$/, ID=/^\d{1,32}$/;
const fail=(ok,k)=>{if(!ok)throw Error('china_v4_custody_base_'+k)};
const sha=x=>createHash('sha256').update(x).digest('hex');
const stableOfferId=(s,id)=>sha(s+':'+id).slice(0,24);
const isAutoApiChe168QuarantineReason=x=>x==='missing_model'||x==='invalid_year';
function validate(db){
 const schema=db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name COLLATE BINARY').all();
 const tbl=schema.find(x=>x.type==='table'&&x.name==='inventory');
 fail(schema.length===2&&tbl?.tbl_name==='inventory'&&tbl.sql.replace(/\s/g,'').toLowerCase()===
   'createtableinventory(idtextprimarykey,payloadtextnotnull,eventintegernotnull)'&&
   schema.some(r=>r.type==='index'&&r.name==='sqlite_autoindex_inventory_1'&&r.tbl_name==='inventory'&&r.sql===null),'schema');
 fail(db.prepare('PRAGMA quick_check').get()?.quick_check==='ok','integrity');
}
/** Only writes a new, runtime-owned PRIVATE restore of the old SQLite file.
 * Never open the accepted shared file or a pathname supplied by source data. */
export function openVerifiedBaseReplay({privateBaseFilename,config,cursorFrom,cursorTo,expectedEvents,within=()=>{}}){
 fail(typeof privateBaseFilename==='string'&&privateBaseFilename.startsWith('/')&&
  Number.isSafeInteger(config?.initialCursor)&&config.initialCursor<=cursorFrom&&Number.isSafeInteger(cursorFrom)&&
  Number.isSafeInteger(cursorTo)&&cursorTo>cursorFrom&&Number.isSafeInteger(expectedEvents)&&expectedEvents>0&&expectedEvents<=500000,'input');
 const db=new DatabaseSync(privateBaseFilename,{readOnly:false,allowExtension:false});
 const withdrawals=new Map(),quarantine=new Map(),missingDetails=createChe168MissingDetails();
 let count=0,current=cursorFrom,finished=false,closed=false;
 try{
  db.exec('PRAGMA trusted_schema=OFF; PRAGMA cache_size=-16384; PRAGMA temp_store=FILE; PRAGMA journal_mode=DELETE;');
  validate(db);
 }catch(e){db.close();throw e;}
 const put=db.prepare('INSERT INTO inventory VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,event=excluded.event WHERE excluded.event>=inventory.event');
 const get=db.prepare('SELECT payload,event FROM inventory WHERE id=?'),remove=db.prepare('DELETE FROM inventory WHERE id=? AND event<=?');
 // Native apply body below is copied exactly from the authenticated V4 worker
 // (normalization was already done before the journal transaction committed).
  const apply=async event=>{
    if(!Number.isSafeInteger(event?.event)||event.event<config.initialCursor-1)throw Error('auto_api_invalid_replica_event');
    if(event.kind==='offer'){
      const o=event.offer;
      if(o?.sourceId!==sourceId||o.market!=='china'||o.id!==stableOfferId(sourceId,String(o.sourceOfferId))
        ||o.operational?.provider!=='auto-api.com'||o.operational?.detailIdentityVerified!==true)throw Error('auto_api_invalid_replica_offer');
      put.run(String(o.sourceOfferId),JSON.stringify(o),event.event);quarantine.delete(String(o.sourceOfferId));
    }else if(event.kind==='price'){
      const row=get.get(event.innerId);
      if(!row||!Number.isFinite(event.price)||event.price<=0||!Number.isFinite(Date.parse(event.at)))throw Error('auto_api_invalid_replica_price');
      if(row.event<=event.event){const o=JSON.parse(row.payload);
        o.sourcePrice=event.price;o.totalRub=null;o.calculationStatus='needs_data';o.updatedAt=event.at;
        o.operational={...o.operational,lastSeenAt:event.at,che168PriceChangeId:event.event};
        put.run(event.innerId,JSON.stringify(o),event.event);}
    }else if(event.kind==='removed'||event.kind==='quarantine'){
      if(!/^\d+$/.test(event.innerId)||!Number.isFinite(Date.parse(event.at)))throw Error('auto_api_invalid_replica_event');
      remove.run(event.innerId,event.event);
      if(event.kind==='quarantine'){
        if(!isAutoApiChe168QuarantineReason(event.reason))throw Error('auto_api_invalid_replica_quarantine');
        quarantine.set(event.innerId,event.reason);
      }else{const id=stableOfferId(sourceId,event.innerId);withdrawals.set(id,{id,sourceId,sourceOfferId:event.innerId,market:'china',status:'removed',observedAt:event.at});quarantine.delete(event.innerId);}
    }else if(event.kind!=='missing_detail')throw Error('auto_api_invalid_replica_event');
    missingDetails.apply(event);
  };
 db.exec('BEGIN');
 return Object.freeze({
  async apply(event){
   within();
   const n=event?.event;
   fail(!finished&&!closed&&Number.isSafeInteger(n)&&n>=current&&n<=cursorTo&&++count<=expectedEvents,'event_scope');
   current=n;
   await apply(event);
  },
  async compare({candidateFilename,expectedCandidateLedgerSha256,expectedRows,maxBytes=8*1024**3}){
   within();
   fail(!closed&&!finished&&count===expectedEvents&&SHA.test(expectedCandidateLedgerSha256)&&Number.isSafeInteger(expectedRows)&&expectedRows>0&&expectedRows<=500000,'terminal_scope');
   missingDetails.assertResolved();db.exec('COMMIT');finished=true;
   const right=new DatabaseSync(candidateFilename,{readOnly:true,allowExtension:false});
   let l,r;
   try{
    right.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA cache_size=-16384;');
    // Existing candidate verifier already proved physical schema, full
    // integrity, and stable inode/stat immediately before this comparison.
    validate(right);
    const sel='SELECT id,payload,event FROM inventory ORDER BY id COLLATE BINARY';
    l=db.prepare(sel).iterate();r=right.prepare(sel).iterate();const digest=createHash('sha256').update('[');
    let rows=0,bytes=0,previous='';
    for(;;){
     if((rows&1023)===0)within();
     const a=l.next(),b=r.next();
     fail(a.done===b.done,'row_count');
     if(a.done)break;
     const x=a.value,y=b.value;
     fail(typeof x.id==='string'&&ID.test(x.id)&&x.id>previous&&x.id===y.id&&typeof x.payload==='string'&&x.payload===y.payload&&
       Number.isSafeInteger(x.event)&&x.event===y.event&&x.event>=config.initialCursor-1&&x.event<=cursorTo,'exact_row');
     const n=Buffer.byteLength(x.payload);fail(n>0&&n<=1024*1024&&(bytes+=n)<=maxBytes,'compare_byte_scope');
     fail(rows<expectedRows,'row_count');if(rows++)digest.update(',');digest.update(JSON.stringify([x.id,sha(x.payload),x.event]));previous=x.id;
    }
    const h=digest.update(']').digest('hex');
    fail(rows===expectedRows&&h===expectedCandidateLedgerSha256,'exact_candidate_ledger');
    return Object.freeze({exactInventoryRows:rows,replayedJournalEvents:count,inventoryPayloadLedgerSha256:h,
      replayedAcceptedBase:true,untouchedBaseInventoryEqualityProven:true,priceOnlyBaseFieldEqualityProven:true,storageWrites:0,
      publicationAuthorized:false,cursorAdvanced:false});
   }finally{l?.return?.();r?.return?.();right.close();}
  },
  close(){if(closed)return;closed=true;if(!finished)try{db.exec('ROLLBACK');}catch{}db.close();}
 });
}
