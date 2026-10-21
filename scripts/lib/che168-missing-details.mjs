/** Tracks unresolved detail reads through a complete ordered replay. Persist each
 * missing event in the private journal; a working cursor is never publication.
 * A 404 alone cannot remove a vehicle or make the replay publishable. */
export function createChe168MissingDetails() {
  const pending=new Map();
  return {
    apply(event) {
      const id=String(event.kind==='offer'?event.offer?.sourceOfferId:event.innerId);
      if(!/^\d+$/.test(id)||!Number.isSafeInteger(event.event)||!Number.isFinite(Date.parse(event.at)))throw Error('auto_api_invalid_missing_detail_event');
      if(event.kind==='missing_detail') {
        const old=pending.get(id);
        if(!old||event.event>old.event)pending.set(id,{event:event.event,at:event.at});
        if(pending.size>100000)throw Error('auto_api_missing_detail_budget');
      } else if(['offer','removed','quarantine'].includes(event.kind)) {
        const old=pending.get(id);
        if(old&&event.event>old.event&&Date.parse(event.at)>=Date.parse(old.at))pending.delete(id);
      }
    },
    assertResolved() { if(pending.size)throw Error('auto_api_detail_404_unresolved'); },
    get size() {return pending.size;}
  };
}
