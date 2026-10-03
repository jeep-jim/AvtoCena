"use client";
import {useEffect,useRef,useState} from 'react';
import {ChevronDown,ChevronUp} from 'lucide-react';
/** Reserve only the inline arrow on the final line, not a column beside all text. */
export function DealerDescription({text}:{text:string}){
 const ref=useRef<HTMLParagraphElement>(null),[short,setShort]=useState(text),[expanded,setExpanded]=useState(false);
 useEffect(()=>{
  const el=ref.current;if(!el)return;
  const measure=()=>{
   const doc=el.ownerDocument,style=doc.defaultView!.getComputedStyle(el),probe=doc.createElement('p');
   probe.style.cssText=`position:fixed;visibility:hidden;pointer-events:none;left:-10000px;top:0;width:${el.clientWidth}px;font:${style.font};line-height:${style.lineHeight};white-space:pre-line;overflow-wrap:anywhere;margin:0;padding:0;`;
   doc.body.appendChild(probe);probe.textContent=text;const max=parseFloat(style.lineHeight)*2+1;
   if(probe.getBoundingClientRect().height<=max){setShort(text);probe.remove();return;}
   const chars=Array.from(text);let low=0,high=chars.length;
   while(low<high){const mid=Math.ceil((low+high)/2);probe.textContent=chars.slice(0,mid).join('').trimEnd()+'…';const arrow=doc.createElement('span');arrow.style.cssText='display:inline-block;width:28px;height:18px;vertical-align:middle';probe.appendChild(arrow);if(probe.getBoundingClientRect().height<=max)low=mid;else high=mid-1;}
   setShort(chars.slice(0,low).join('').trimEnd()+'…');probe.remove();
  };measure();const observer=new ResizeObserver(measure);observer.observe(el);docFonts(el).then(measure);return()=>observer.disconnect();
 },[text]);
 const more=short!==text;
 return <div className="dealer-intro-wrap"><p ref={ref} className={`dealer-intro ${expanded?'is-expanded':''}`}>{expanded?text:short}{more&&<button type="button" className="dealer-expand" aria-expanded={expanded} aria-label={expanded?'Свернуть описание':'Развернуть описание'} onClick={()=>setExpanded(!expanded)}>{expanded?<ChevronUp size={18}/>:<ChevronDown size={18}/>}</button>}</p></div>;
}
function docFonts(el:HTMLElement){return el.ownerDocument.fonts?.ready||Promise.resolve();}
