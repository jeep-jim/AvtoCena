/** One observer per mounted logo collection, not one per logo. No network I/O. */
const listeners=new Set<()=>void>();
let observer:MutationObserver|null=null;
export const serverBrandTheme=():"light"|"dark"=>"light";
export const readBrandTheme=():"light"|"dark"=>typeof document!=="undefined"&&document.documentElement.dataset.theme==="dark"?"dark":"light";
export function subscribeBrandTheme(notify:()=>void){
  listeners.add(notify);
  if(!observer&&typeof document!=="undefined"){
    observer=new MutationObserver(()=>{for(const listener of [...listeners])listener();});
    observer.observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});
  }
  return ()=>{listeners.delete(notify);if(!listeners.size){observer?.disconnect();observer=null;}};
}
