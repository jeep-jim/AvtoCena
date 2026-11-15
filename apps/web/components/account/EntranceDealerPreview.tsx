'use client';
import {useEffect,useRef,useState} from 'react';
import {DealerLivePreview,type PublishedDealerPreview} from '@/components/dealers/DealerLivePreview';
export function EntranceDealerPreview({dealer}:{dealer?:PublishedDealerPreview}){
 const [loadedDealer, setLoadedDealer] = useState<PublishedDealerPreview | null>(null);
 const visibleDealer = dealer ?? loadedDealer;
 useEffect(() => {
   if (dealer) return;
   const request = new AbortController();
   async function loadPreview() {
     try {
       const response = await fetch('/api/login/dealer-preview', {signal: request.signal, cache: 'no-store'});
       if (!response.ok) return;
       const preview: PublishedDealerPreview | null = await response.json();
       if (!request.signal.aborted) setLoadedDealer(preview);
     } catch {
       // The profile link remains available when the preview cannot load.
     }
   }
   void loadPreview();
   return () => request.abort();
 }, [dealer]);
 const root=useRef<HTMLDivElement>(null),[atEnd,setAtEnd]=useState(false);
 useEffect(()=>{
  let frame=0;
  const measure=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{const dock=root.current?.querySelector('.dealer-inline-preview .dealer-dock');setAtEnd(!!dock&&dock.getBoundingClientRect().bottom<window.innerHeight-1);});};
  const observer=new ResizeObserver(measure);if(root.current)observer.observe(root.current);
  window.addEventListener('scroll',measure,{passive:true});window.addEventListener('resize',measure);measure();
  return()=>{observer.disconnect();cancelAnimationFrame(frame);window.removeEventListener('scroll',measure);window.removeEventListener('resize',measure);};
 },[]);
 return <div ref={root} className="entrance-dealer-preview" data-dock-at-end={atEnd}>{visibleDealer?<DealerLivePreview published={visibleDealer} pageScroll section="profile" verified={visibleDealer.verified===true} fullAccess/>:<a href="/nvkz/topavto">Открыть ТопАвто →</a>}</div>;
}
