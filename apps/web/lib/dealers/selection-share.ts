/** Public catalogue parameters only: never forward editor flags, tokens or lead data. */
export const SELECTION_TITLE='Подборка вариантов по вашему запросу';
export const SELECTION_EVENT='avtocena:dealer-selection';
export const OPEN_SELECTION_FILTERS='avtocena:dealer-selection-filters';
const textKeys=['q','make','brand','model','market','stock','source','chassis','frameNumber','lotNumber','bodyType','transmission','fuel','drive','auctionGrade','city','hasPrice'];
const numberKeys=['yearFrom','yearTo','budgetFrom','budget','budgetTo','mileageFrom','mileageTo','engineFrom','engineTo','powerFrom','powerTo'];
export function selectionQuery(input:URLSearchParams,strict=true){
 const out=new URLSearchParams();
 for(const key of textKeys){const value=input.get(key)?.trim();if(!value)continue;if(value.length>300||/[<>\u0000-\u001f\u007f]/.test(value)){if(strict)throw Error('invalid_selection');continue;}out.set(key,value);}
 for(const key of numberKeys){const value=input.get(key);if(!value)continue;if(!/^\d{1,9}(?:[.,]\d{1,3})?$/.test(value)){if(strict)throw Error('invalid_selection');continue;}out.set(key,value);}
 const sort=input.get('sort');if(sort){if(['updatedAt','totalRub','totalRubDesc','year','yearAsc','mileage'].includes(sort))out.set('sort',sort);else if(strict)throw Error('invalid_selection');}
 return out;
}
export function selectionTarget(dealerId:string,query:string){
 if(!/^[a-zA-Z0-9_-]{1,80}$/.test(dealerId))throw Error('invalid_selection');
 const params=selectionQuery(new URLSearchParams(query));params.set('selection','1');
 return `/dealers/${dealerId}?${params}#catalog`;
}

export function selectionTitle(value:unknown){
 if(typeof value!=='string')return '';
 return value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,160);
}
