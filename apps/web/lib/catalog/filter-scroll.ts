// Keep the last reading position across a delayed filter response, including
// an RSC remount after the filter sheet has already closed. Never persist it.
let pending:{target:string;from:string;y:number;dispose:()=>void}|null=null;
function key(value:string){const u=new URL(value,location.origin);u.searchParams.sort();return u.pathname+u.search;}
function position(){return document.body.style.position==='fixed'?Math.max(0,-parseFloat(document.body.style.top)||0):window.scrollY;}
export function rememberFilterScroll(href:string){
 pending?.dispose();
 const entry={target:key(href),from:key(location.href),y:position(),dispose:()=>{}};
 const track=()=>{if(document.body.style.position!=='fixed'&&entry.from!==entry.target&&key(location.href)===entry.from)entry.y=window.scrollY;};
 const timer=window.setTimeout(()=>entry.dispose(),60000);
 entry.dispose=()=>{window.clearTimeout(timer);window.removeEventListener('scroll',track);if(pending===entry)pending=null;};
 pending=entry;window.addEventListener('scroll',track,{passive:true});
 window.dispatchEvent(new CustomEvent('avtocena:catalog-navigation',{detail:{href}}));
}
export function restoreFilterScroll(){
 let second=0;
 const first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>{
  const entry=pending;if(!entry||key(location.href)!==entry.target)return;
  // The sheet owns body unlocking and restores its own captured position.
  if(document.body.style.position!=='fixed')window.scrollTo({top:entry.y,behavior:'instant'});
  entry.dispose();
 });});
 return()=>{cancelAnimationFrame(first);cancelAnimationFrame(second);};
}
