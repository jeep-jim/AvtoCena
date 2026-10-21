export type SelectionDraft={title:string;textOpen:boolean;dismissed:string|null;opened:boolean};
export const emptySelectionDraft:SelectionDraft={title:'',textOpen:false,dismissed:null,opened:false};
const drafts=new Map<string,SelectionDraft>();
const key=(dealerId:string)=>'avtocena:selection-draft:v1:'+dealerId;
export function readSelectionDraft(dealerId:string):SelectionDraft{
 if(drafts.has(dealerId))return drafts.get(dealerId)!;
 try{const value=JSON.parse(sessionStorage.getItem(key(dealerId))||'null');
  if(value&&typeof value.title==='string'){
   const draft={title:value.title.slice(0,160),textOpen:value.textOpen===true,dismissed:typeof value.dismissed==='string'?value.dismissed:null,opened:value.opened===true};drafts.set(dealerId,draft);return draft;
  }
 }catch{}
 return {...emptySelectionDraft};
}
export function saveSelectionDraft(dealerId:string,draft:SelectionDraft){
 drafts.set(dealerId,draft);
 try{sessionStorage.setItem(key(dealerId),JSON.stringify(draft));}catch{}
}
