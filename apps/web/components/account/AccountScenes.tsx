'use client';

import {Fragment,memo,useEffect,useMemo,useRef,useState} from 'react';
import {Pause,Play,ChevronLeft,ChevronRight} from 'lucide-react';
import type {AccountRole} from '@/lib/account-appearance';
import {ACCOUNT_SCENES,sceneMarkup} from './scene-content';
import './account-scenes.css';

// Keep the injected subtree intact when hover, pause or parent headings update.
const SceneBody = memo(function SceneBody({html,kind}:{html:string;kind:string}) {
  return <div className="account-scene" data-kind={kind} dangerouslySetInnerHTML={{__html:html}}/>;
});

type Props = {role:AccountRole; onSceneChange?:(index:number)=>void};
export function AccountScenes({role,onSceneChange}:Props) {
  const [index,setIndex]=useState(0), [paused,setPaused]=useState(false), [reduced,setReduced]=useState(false);
  const [held,setHeld]=useState(false);
  const [hovered,setHovered]=useState(false), [demoNotice,setDemoNotice]=useState('');
  const manualRating=useRef<number|null>(null);
  const root=useRef<HTMLDivElement>(null), pointer=useRef<{x:number;y:number}|null>(null);
  const items=ACCOUNT_SCENES[role], scene=items[index%items.length];
  const html=useMemo(()=>sceneMarkup(scene,role),[scene,role]);
  const stopped=paused||reduced;
  const holdCarousel=stopped||hovered||held;
  useEffect(()=>{const media=matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setReduced(media.matches);update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
  useEffect(()=>{onSceneChange?.(index);setDemoNotice('');},[index,onSceneChange]);
  useEffect(()=>{
    if(holdCarousel)return;
    const timer=setInterval(()=>{if(!document.hidden)setIndex(i=>(i+1)%items.length);},scene.template===0?13000:scene.template===1?14000:scene.template===4?13000:10000);
    return()=>clearInterval(timer);
  },[holdCarousel,items.length,index,scene.template]);

  // Animate only inside this mounted scene; every frame is cancelled on switch/unmount.
  const running=useRef(false);running.current=!stopped;
  const reducedRef=useRef(reduced);reducedRef.current=reduced;
  useEffect(()=>{
    const node=root.current;if(!node)return;manualRating.current=null;
    const get=(id:string)=>node.querySelector<HTMLElement>(`[data-demo-id="${id}"]`);
    let frame=0, elapsed=0, previous=0;
    const map=get('trackMap'), car=get('trackTruck');
    let routeStart=0, routeWidth=0, noticeStep=90;
    const measure=()=>{
      if(map){const points=map.querySelectorAll<HTMLElement>('.track-point-wrap');const a=map.getBoundingClientRect();const first=points[0]?.getBoundingClientRect(),end=points[2]?.getBoundingClientRect();if(first&&end){routeStart=first.left-a.left+first.width/2;routeWidth=end.left+end.width/2-a.left-routeStart;}}
      const notices=node.querySelectorAll<HTMLElement>('.notif-item');if(notices.length>1)noticeStep=notices[1].offsetTop-notices[0].offsetTop;
    };
    const resize=new ResizeObserver(measure);resize.observe(node);measure();
    const lines=node.querySelectorAll('.contract-viewer-line');
    const toggle=(id:string,name:string,on:boolean)=>get(id)?.classList.toggle(name,on);
    const signature=node.querySelector<SVGPathElement>('.contract-signature path');
    const signatureLength=signature?.getTotalLength()||1;
    if(signature){signature.style.strokeDasharray=String(signatureLength);signature.style.strokeDashoffset=String(signatureLength);}
    const tick=(now:number)=>{
      if(previous&&running.current&&!document.hidden)elapsed+=Math.min(now-previous,100);
      previous=now;
      const time=reducedRef.current?10000:elapsed;
      if(scene.template===0){
        const count=reducedRef.current?6:Math.min(6,1+Math.floor(time/1700));
        node.querySelectorAll<HTMLElement>('.chat-msg').forEach((message,i)=>message.classList.toggle('is-visible',i<count&&i>=Math.max(0,count-3)));
        const typing=node.querySelector<HTMLElement>('.chat-typing');if(typing)typing.style.visibility=count===6?'hidden':'visible';
      }
      if(scene.template===1){
        toggle('contractIntro','is-hidden',time>=600);
        toggle('contractViewer','is-active',time>=600);
        lines.forEach((line,i)=>line.classList.toggle('is-visible',time>=900+i*340));
        const progress=Math.max(0,Math.min(1,(time-4100)/2200));
        if(signature)signature.style.strokeDashoffset=String(signatureLength*(1-progress));
        toggle('contractSignature','is-signing',progress>0);
        toggle('contractConfirmCheck','is-visible',time>=6500);
        toggle('contractStatus','is-visible',time>=7000);
        const hint=get('contractSignHint');if(hint)hint.textContent=time>=6500?'Подписано':time>=4100?'Подписание…':'Ожидание подписи…';
      }
      if(scene.template===2){
        const progress=Math.min(time/5000,1);
        if(car)car.style.left=`${routeStart+routeWidth*progress}px`;
        toggle('trackArrival','is-visible',progress===1);
      }
      if(scene.template===4){
        const shift=reducedRef.current?2:Math.min(2,Math.floor(time/3300));
        const stream=get('notificationStream');if(stream)stream.style.transform=`translateY(${-shift*noticeStep}px)`;
        const badge=node.querySelector('.notif-bell-badge');if(badge)badge.textContent=String(3+shift);
      }
      if(scene.template===5){
        const rating=manualRating.current??(reducedRef.current?5:Math.min(5,Math.floor(time/700)));
        node.querySelectorAll<HTMLElement>('.review-star').forEach((star,i)=>{star.classList.toggle('is-filled',i<rating);star.setAttribute('aria-pressed',String(i<rating));});
        const label=get('reviewRating');if(label)label.textContent=rating+',0';
      }
      if(!reducedRef.current)frame=requestAnimationFrame(tick);
    };
    tick(performance.now());return()=>{cancelAnimationFrame(frame);resize.disconnect();};
  },[html,scene.template,reduced]);

  function move(step:number){setHeld(true);setIndex(i=>(i+step+items.length)%items.length);}
  return <div ref={root} className="account-scenes" data-role={role} data-paused={stopped} data-reduced={reduced} aria-label="Возможности кабинета" aria-roledescription="карусель"
    onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)}
    onKeyDown={e=>{if((e.target as HTMLElement).matches('input,textarea'))return;if(e.key==='ArrowRight'){e.preventDefault();move(1);}if(e.key==='ArrowLeft'){e.preventDefault();move(-1);}}}>
    <div className="demo-stage" onPointerDown={e=>{pointer.current={x:e.clientX,y:e.clientY};}} onPointerUp={e=>{const start=pointer.current;pointer.current=null;if(start&&Math.abs(e.clientX-start.x)>50&&Math.abs(e.clientX-start.x)>Math.abs(e.clientY-start.y)*1.4)move(e.clientX<start.x?1:-1);}} onPointerCancel={()=>{pointer.current=null;}}>
      <div className="scene-event-layer" onClick={e=>{
        const target=(e.target as HTMLElement).closest<HTMLButtonElement>('button');if(!target)return;
        if(target.dataset.star){const value=Number(target.dataset.star);manualRating.current=value;const label=root.current?.querySelector('[data-demo-id="reviewRating"]');if(label)label.textContent=value+',0';root.current?.querySelectorAll<HTMLElement>('.review-star').forEach((star,i)=>{star.classList.toggle('is-filled',i<value);star.setAttribute('aria-pressed',String(i<value));});setHeld(true);}
        else if(target.classList.contains('review-tag')){target.classList.toggle('is-active');target.setAttribute('aria-pressed',String(target.classList.contains('is-active')));setHeld(true);}
        else if(target.classList.contains('chat-chip')){setHeld(true);setDemoNotice(role==='blogger'||role==='supplier'?'Расскажите о себе в форме заявки рядом.':'Войдите в кабинет, чтобы открыть свою переписку и документы.');}
      }}><SceneBody key={role+index} html={html} kind={['chat','contract','route','docs','bell','review'][scene.template]}/></div>
    </div>
    <div className="account-scene-controls">
      <div className="steps-bar">{items.map((item,i)=><Fragment key={item.title}>
        <button type="button" className={`step-node${i===index?' is-active':i<index?' is-done':''}`} aria-label={`Сцена ${i+1}: ${item.title}`} aria-pressed={i===index} onClick={()=>{setHeld(true);setIndex(i);}}>{i+1}</button>
        {i<items.length-1&&<div className={`step-connector${i<index?' is-done':i===index?' is-active':''}`}><div className="step-drop"/></div>}
      </Fragment>)}</div>
      <div className="scene-navigation"><span>{role==='blogger'||role==='supplier'?'Закрытая бета · знакомство':'Пример возможностей кабинета'}</span><button type="button" aria-label="Предыдущая сцена" onClick={()=>move(-1)}><ChevronLeft size={15}/></button><button type="button" aria-label={paused||reduced?'Включить смену сцен':'Остановить смену сцен'} onClick={()=>{setReduced(false);setHeld(false);setPaused(!(paused||reduced));}}>{paused||reduced?<Play size={13}/>:<Pause size={13}/>}</button><button type="button" aria-label="Следующая сцена" onClick={()=>move(1)}><ChevronRight size={15}/></button></div>
    </div>
    {demoNotice&&<div className="scene-notice" role="status">{demoNotice}<button type="button" aria-label="Закрыть подсказку" onClick={()=>setDemoNotice('')}>×</button></div>}
  </div>;
}
