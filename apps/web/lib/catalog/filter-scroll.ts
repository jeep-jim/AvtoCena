// Preserve the reading position while a filter or category response is pending.
let pending:{target:string;from:string;y:number;anchorTop:number|null;dispose:()=>void}|null=null;
function key(value:string){const u=new URL(value,location.origin);u.searchParams.sort();return u.pathname+u.search;}
function position(){return document.body.style.position==='fixed'?Math.max(0,-parseFloat(document.body.style.top)||0):window.scrollY;}
let lockedAnchor:{top:number|null}|null=null;
/** Fixed-body mobile sheets change layout geometry. Retain the document anchor
 * measured before locking, not the sheet's temporary bounding rectangle. */
export function lockFilterScrollAnchor(){
 const previous=lockedAnchor;const entry={top:catalogTop()};lockedAnchor=entry;
 return ()=>{if(lockedAnchor===entry)lockedAnchor=previous;};
}
function catalogTop(){if(document.body.style.position==='fixed'&&lockedAnchor)return lockedAnchor.top;const node=document.querySelector('#catalog');return node?node.getBoundingClientRect().top+position():null;}
export function rememberFilterScroll(href:string){
 pending?.dispose();
 const entry={target:key(href),from:key(location.href),y:position(),anchorTop:catalogTop(),dispose:()=>{}};
 const track=()=>{if(document.body.style.position!=='fixed'&&entry.from!==entry.target&&key(location.href)===entry.from)entry.y=window.scrollY;};
 const timer=window.setTimeout(()=>entry.dispose(),60000);
 entry.dispose=()=>{window.clearTimeout(timer);window.removeEventListener('scroll',track);if(pending===entry)pending=null;};
 pending=entry;window.addEventListener('scroll',track,{passive:true});
 window.dispatchEvent(new CustomEvent('avtocena:catalog-navigation',{detail:{href}}));
}
export function restoreFilterScroll(){
 const entry=pending;if(!entry||key(location.href)!==entry.target)return;
 // Run in layout effect, before paint. The sheet restores its captured position.
 if(document.body.style.position==='fixed')return;
 const top=catalogTop();
 const delta=top!==null&&entry.anchorTop!==null?top-entry.anchorTop:0;
 window.scrollTo({top:Math.max(0,entry.y+delta),behavior:'instant'});
 entry.dispose();
}
