'use client';

import {Fragment,useEffect,useMemo,useRef,useState} from 'react';
import {Pause,Play,ChevronLeft,ChevronRight} from 'lucide-react';
import type {AccountRole} from '@/lib/account-appearance';
import {ACCOUNT_SCENES,sceneMarkup} from './scene-content';
import './account-scenes.css';

type Props = {role:AccountRole; onSceneChange?:(index:number)=>void};
export function AccountScenes({role,onSceneChange}:Props) {
  const [index,setIndex]=useState(0), [paused,setPaused]=useState(false), [reduced,setReduced]=useState(false);
  const [held,setHeld]=useState(false);
  const [hovered,setHovered]=useState(false), [demoNotice,setDemoNotice]=useState('');
  const root=useRef<HTMLDivElement>(null), pointer=useRef<{x:number;y:number}|null>(null);
  const items=ACCOUNT_SCENES[role], scene=items[index%items.length];
  const html=useMemo(()=>sceneMarkup(scene,role),[scene,role]);
  const stopped=paused||reduced;
  const holdCarousel=stopped||hovered||held;
  useEffect(()=>{const media=matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setReduced(media.matches);update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
  useEffect(()=>{onSceneChange?.(index);setDemoNotice('');},[index,onSceneChange]);
  useEffect(()=>{
    if(holdCarousel)return;
    const timer=setInterval(()=>{if(!document.hidden)setIndex(i=>(i+1)%items.length);},scene.template===1?14000:8000);
    return()=>clearInterval(timer);
  },[holdCarousel,items.length,index,scene.template]);

  // Animate only inside this mounted scene; every frame is cancelled on switch/unmount.
  const running=useRef(false);running.current=!stopped;
  const reducedRef=useRef(reduced);reducedRef.current=reduced;
  useEffect(()=>{
    const node=root.current;if(!node || (scene.template!==1 && scene.template!==2))return;
    const get=(id:string)=>node.querySelector<HTMLElement>(`[data-demo-id="${id}"]`);
    let frame=0, elapsed=0, previous=0;
    const map=get('trackMap'), car=get('trackTruck'), segment=map?.querySelector<HTMLElement>('.track-segment.is-active');
    let routeStart=0, routeWidth=0;
    const measure=()=>{if(map&&segment){const a=map.getBoundingClientRect(),b=segment.getBoundingClientRect();routeStart=b.left-a.left;routeWidth=b.width;}};
    const resize=new ResizeObserver(measure);if(map){resize.observe(map);measure();}
    const lines=node.querySelectorAll('.contract-viewer-line');
    const toggle=(id:string,name:string,on:boolean)=>get(id)?.classList.toggle(name,on);
    const tick=(now:number)=>{
      if(previous&&running.current&&!document.hidden)elapsed+=Math.min(now-previous,100);
      previous=now;
      const time=reducedRef.current?8000:elapsed%14000;
      if(scene.template===1){
        toggle('contractIntro','is-hidden',time>=2000&&time<12000);
        toggle('contractViewer','is-active',time>=2000&&time<12000);
        lines.forEach((line,i)=>line.classList.toggle('is-visible',time>=2400+i*160));
        toggle('contractPen','is-writing',time>=4200&&time<12000);
        toggle('contractSignature','is-signing',time>=4350&&time<12000);
        toggle('contractConfirmCheck','is-visible',time>=6800&&time<12000);
        toggle('contractStatus','is-visible',time>=7500&&time<12000);
        const hint=get('contractSignHint');if(hint)hint.textContent=time>=6800?'Подписано':time>=4200?'Подписание…':'Ожидание подписи…';
      }
      if(scene.template===2){
        if(car){const p=reducedRef.current ? .65 : Math.min((elapsed%8000)/6000,1);car.style.left=`${routeStart+routeWidth*p}px`;}
      }
      if(!reducedRef.current)frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);return()=>{cancelAnimationFrame(frame);resize.disconnect();};
  },[html,scene.template,reduced]);

  function move(step:number){setHeld(true);setIndex(i=>(i+step+items.length)%items.length);}
  return <div ref={root} className="account-scenes" data-role={role} data-paused={stopped} data-reduced={reduced} aria-label="Возможности кабинета" aria-roledescription="карусель"
    onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)}
    onKeyDown={e=>{if((e.target as HTMLElement).matches('input,textarea'))return;if(e.key==='ArrowRight'){e.preventDefault();move(1);}if(e.key==='ArrowLeft'){e.preventDefault();move(-1);}}}>
    <div className="demo-stage" onPointerDown={e=>{pointer.current={x:e.clientX,y:e.clientY};}} onPointerUp={e=>{const start=pointer.current;pointer.current=null;if(start&&Math.abs(e.clientX-start.x)>50&&Math.abs(e.clientX-start.x)>Math.abs(e.clientY-start.y)*1.4)move(e.clientX<start.x?1:-1);}} onPointerCancel={()=>{pointer.current=null;}}>
      <div key={role+index} className="account-scene" data-kind={['chat','contract','route','docs','bell','review'][scene.template]} onClick={e=>{
        const target=(e.target as HTMLElement).closest<HTMLButtonElement>('button');if(!target)return;
        if(target.dataset.star){const value=Number(target.dataset.star);root.current?.querySelectorAll<HTMLElement>('.review-star').forEach((star,i)=>{star.classList.toggle('is-filled',i<value);star.setAttribute('aria-pressed',String(i<value));});setHeld(true);}
        else if(target.classList.contains('review-tag')){target.classList.toggle('is-active');target.setAttribute('aria-pressed',String(target.classList.contains('is-active')));setHeld(true);}
        else if(target.dataset.demoId==='reviewSubmit'){
          setHeld(true);setDemoNotice('Это пример. Свой отзыв можно оставить в кабинете после подтверждения подписанного договора.');
          const layer=root.current?.querySelector<HTMLElement>('.review-celebration');
          if(layer&&!reduced){layer.replaceChildren();layer.classList.add('is-active');
            const colors=['#ffc947','#4ade80','#60a5fa','#7c5cff','#ff6ec7'];
            for(let i=0;i<36;i++){const piece=document.createElement('span');piece.className='confetti is-active';piece.style.background=colors[i%colors.length];piece.style.setProperty('--tx',`${(i*73)%440-220}px`);piece.style.setProperty('--ty',`${(i*97)%380-100}px`);piece.style.setProperty('--rot',`${i*47}deg`);piece.style.animationDelay=`${i%5*.05}s`;layer.appendChild(piece);}
          }
        }
        else if(target.classList.contains('chat-chip')){setHeld(true);setDemoNotice(role==='blogger'||role==='supplier'?'Расскажите о себе в форме заявки рядом.':'Войдите в кабинет, чтобы открыть свою переписку и документы.');}
      }} dangerouslySetInnerHTML={{__html:html}}/>
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
