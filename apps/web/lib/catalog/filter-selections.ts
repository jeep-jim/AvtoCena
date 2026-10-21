/** OR within a categorical field; separate fields are combined with AND. */
export function filterSelections(value:unknown):string[]{
 return [...new Set(String(value??'').split('|').map(v=>v.trim()).filter(Boolean))];
}
export function matchesFilterSelection(actual:unknown,selected:unknown):boolean{
 const values=filterSelections(selected);if(!values.length)return true;
 const key=(value:unknown)=>String(value??'').trim().toLocaleLowerCase('ru-RU');
 return values.some(value=>key(value)===key(actual));
}
