import {createHash} from 'node:crypto';
const source='autohome_used_china_open';
const sha=value=>createHash('sha256').update(value).digest('hex');
const order=['bodyType','drive','transmission','color'];
const choices={
 bodyType:new Set(['sedan','hatchback','wagon','suv','offroad','minivan','coupe','convertible','pickup','van']),
 drive:new Set(['fwd','rwd','awd']),transmission:new Set(['automatic','manual','cvt','dct']),
};
const safe=value=>value&&typeof value==='object'&&!Array.isArray(value);
export function validPreparedChinaEditorialSpecifications(value){
 return safe(value)&&Object.keys(value).length>0&&Object.entries(value).every(([key,text])=>order.includes(key)&&
  typeof text==='string'&&text.length>0&&text.trim()===text&&!/[\x00-\x1f\x7f]/.test(text)&&
  (key==='color'?text.length<=60:choices[key].has(text)));
}
/** Only this paid marketplace identity can change the independent China cut.
 * Ignore unrelated markets and previous providers; never hash editor identity,
 * comments or timestamps into the public cut contract. */
export function preparedChinaEditorialEvidence(index){
 if(!safe(index)||!safe(index.entries))throw Error('china_prepared_editorial:index');
 const accepted=new Map(),fingerprint=[];
 for(const [key,row] of Object.entries(index.entries).sort(([a],[b])=>a<b?-1:a>b?1:0)){
  if(!safe(row))throw Error('china_prepared_editorial:entry');
  if(row.market!=='china'||row.sourceId!==source)continue;
  if(typeof row.sourceOfferId!=='string'||!/^\d{1,150}$/.test(row.sourceOfferId)||
   key!==row.id||sha(source+':'+row.sourceOfferId).slice(0,24)!==row.id)throw Error('china_prepared_editorial:identity');
  const specs=row.specifications;
  const ordered=specs&&validPreparedChinaEditorialSpecifications(specs)?Object.fromEntries(order.filter(k=>Object.hasOwn(specs,k)).map(k=>[k,specs[k]])):undefined;
  // Hidden/archive is an omission, not a provider withdrawal. Existing stage
  // supports spec edits with no seller/metadata conflict. Other kinds suppress
  // only their exact matched offer, until dedicated replay support is enabled.
  const disposition=row.status==='hidden'||row.status==='archived'?'hidden':
   row.status!=='visible'||row.sellerPrice!=null||row.title||row.photos!=null||
   (specs!==undefined&&(!safe(specs)||Object.keys(specs).length>0&&!ordered))?'conflict':ordered?'specs':'none';
  accepted.set(key,{disposition,specifications:ordered,sourceOfferId:row.sourceOfferId});
  if(disposition!=='none')fingerprint.push([key,row.sourceOfferId,disposition,...(disposition==='specs'?[ordered]:[])]);
 }
 return {sha256:sha(JSON.stringify(['china-paid-editorial-effective-v1',fingerprint])),accepted};
}
export function chinaPreparedEditorialOffer(row,evidence){
 const e=evidence.accepted.get(row.id);
 if(!e||row.market!=='china'||row.sourceId!==source||row.sourceOfferId!==e.sourceOfferId||e.disposition==='none')return {row};
 if(e.disposition==='hidden')return {reason:'editorial_hidden'};
 if(e.disposition==='conflict')return {reason:'editorial_conflict'};
 const specs=e.specifications;
 // Prevent manual body category changes from replacing source evidence in an
 // already admitted light-vehicle cut; these need a fresh commercial audit.
 if(specs.bodyType&&specs.bodyType!==row.bodyType&&(
   ['pickup','van'].includes(specs.bodyType)||/pickup|пикап|皮卡|van|фургон|bus|автобус|truck|грузов/i.test(String(row.bodyType??''))||
   /^(?:N|M[23])/i.test(String(row.vehicleCategory??''))))return {reason:'editorial_category_conflict'};
 return {row:{...row,...specs,editorialSpecifications:specs}};
}
