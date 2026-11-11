import {canonicalCatalogHref} from './catalog-routes';

type Kind='forward'|'history'|'preserve';
type Intent={kind:Kind;key:string;anchor:boolean;finished:boolean};
let intent:Intent|null=null;
let tracking=false;
function target(href:string){
 const url=new URL(href,location.origin);
 const canonical=new URL(canonicalCatalogHref(url.pathname+url.search),location.origin);
 canonical.searchParams.sort();
 return {key:canonical.pathname+canonical.search,anchor:Boolean(url.hash)};
}
/** A filter update is explicitly different from opening a new page. */
export function rememberRouteScroll(href:string,kind:Kind='forward'){
 intent={...target(href),kind,finished:false};
}
export function isHistoryRoute(){
 return intent?.kind==='history'&&intent.key===target(location.href).key;
}
export function isPreservedRoute(){
 return intent?.kind==='preserve'&&intent.key===target(location.href).key;
}
export function trackRouteScroll(){
 if(tracking)return;
 tracking=true;
 const click=(event:MouseEvent)=>{
  if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey)return;
  const anchor=event.target instanceof Element?event.target.closest<HTMLAnchorElement>('a[href]'):null;
  if(!anchor||anchor.hasAttribute('download')||anchor.target&&anchor.target!=='_self')return;
  const url=new URL(anchor.href,location.href);
  if(url.origin!==location.origin)return;
  if(target(url.href).key===target(location.href).key)return;
  rememberRouteScroll(url.href,anchor.dataset.scrollPreserve==='true'?'preserve':'forward');
 };
 const pop=()=>rememberRouteScroll(location.href,'history');
 document.addEventListener('click',click,true);
 // Mark Back before the router's bubble handler can synchronously mount a page.
 window.addEventListener('popstate',pop,true);
 // One bounded tab-level listener survives a catalog unmount. A streamed or
 // deferred header must not be the prerequisite for recognizing Back.
}
/** Commit once for an actual forward navigation, never on every render or Back. */
export function completeRouteScroll(){
 const entry=intent;
 if(!entry||entry.finished||entry.kind!=='forward'||entry.anchor||entry.key!==target(location.href).key)return;
 entry.finished=true;
 const top=()=>{if(intent===entry&&entry.key===target(location.href).key&&document.body.style.position!=='fixed')window.scrollTo({top:0,left:0,behavior:'instant'});};
 top();
 // Overlay cleanup and Next's layout pass can run later in the same commit.
 const frame=requestAnimationFrame(top);
 return ()=>cancelAnimationFrame(frame);
}
