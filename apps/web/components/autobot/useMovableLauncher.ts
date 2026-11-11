'use client';
import {useEffect,useRef,useState,type CSSProperties,type PointerEvent} from 'react';
const KEY='avtocena.autobot.position.v1';
type Point={x:number;y:number};
export function useMovableLauncher(){
 const ref=useRef<HTMLButtonElement>(null),[position,setPosition]=useState<Point|null>(null),[moving,setMoving]=useState(false);
 const gesture=useRef<{id:number;x:number;y:number;origin:Point;active:boolean;timer:ReturnType<typeof setTimeout>}|null>(null),suppress=useRef(false);
 function clamp(p:Point){const w=ref.current?.offsetWidth||56,h=ref.current?.offsetHeight||56;const header=document.querySelector('.ac-public-header')?.getBoundingClientRect();const top=Math.max(8,Math.min(header?.bottom||8,innerHeight-h-8));return {x:Math.max(8,Math.min(innerWidth-w-8,p.x)),y:Math.max(top,Math.min(innerHeight-h-12,p.y))};}
 function save(p:Point){const next=clamp(p);setPosition(next);try{localStorage.setItem(KEY,JSON.stringify(next));}catch{}}
 useEffect(()=>{try{const p=JSON.parse(localStorage.getItem(KEY)||'null');if(p&&Number.isFinite(p.x)&&Number.isFinite(p.y))setPosition(clamp(p));}catch{}const resize=()=>setPosition(p=>p?clamp(p):null);window.addEventListener('resize',resize);return()=>{window.removeEventListener('resize',resize);if(gesture.current)clearTimeout(gesture.current.timer);};},[]);
 function down(e:PointerEvent<HTMLButtonElement>){if(!matchMedia('(max-width:899px)').matches||e.button!==0||gesture.current)return;suppress.current=false;const rect=e.currentTarget.getBoundingClientRect();const g={id:e.pointerId,x:e.clientX,y:e.clientY,origin:{x:rect.left,y:rect.top},active:false,timer:setTimeout(()=>{g.active=true;suppress.current=true;setMoving(true);},350)};gesture.current=g;e.currentTarget.setPointerCapture(e.pointerId);}
 function move(e:PointerEvent<HTMLButtonElement>){const g=gesture.current;if(!g||g.id!==e.pointerId)return;if(!g.active){if(Math.hypot(e.clientX-g.x,e.clientY-g.y)>10){clearTimeout(g.timer);suppress.current=true;}return;}save({x:g.origin.x+e.clientX-g.x,y:g.origin.y+e.clientY-g.y});}
 function end(e:PointerEvent<HTMLButtonElement>){const g=gesture.current;if(!g||g.id!==e.pointerId)return;clearTimeout(g.timer);gesture.current=null;setMoving(false);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}
 return {ref,moving,style:position?{'--ab-x':position.x+'px','--ab-y':position.y+'px'} as CSSProperties:undefined,onPointerDown:down,onPointerMove:move,onPointerUp:end,onPointerCancel:end,onContextMenu:(e:React.MouseEvent)=>{if(matchMedia('(max-width:899px)').matches)e.preventDefault();},consumeDrag:()=>{const value=suppress.current;suppress.current=false;return value;}};
}
