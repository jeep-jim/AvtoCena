export const ENCYCLOPEDIA_UPDATED_EVENT='avtocena:encyclopedia-updated';
export const ENCYCLOPEDIA_UPDATED_KEY='avtocena.encyclopedia-updated.v1';
export function notifyEncyclopediaUpdate(){
 window.dispatchEvent(new Event(ENCYCLOPEDIA_UPDATED_EVENT));
 try{localStorage.setItem(ENCYCLOPEDIA_UPDATED_KEY,`${Date.now()}:${Math.random()}`);}catch{}
}
